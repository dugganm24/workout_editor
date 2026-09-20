import {
  SCHEMA_VERSION,
  WorkoutSchema,
  type ExerciseStep,
  type Workout,
  type WorkoutStep,
} from '../model/workout.js';

/** Connect stores weight in this unit; the canonical model is kilograms. */
const GRAMS_PER_POUND = 453.59237;
const POUND = { unitId: 9, unitKey: 'pound', factor: GRAMS_PER_POUND } as const;

const SPORT = {
  sportTypeId: 5,
  sportTypeKey: 'strength_training',
  displayOrder: 4,
} as const;

const STEP_TYPE = {
  interval: { stepTypeId: 3, stepTypeKey: 'interval', displayOrder: 3 },
  rest: { stepTypeId: 5, stepTypeKey: 'rest', displayOrder: 5 },
  repeat: { stepTypeId: 6, stepTypeKey: 'repeat', displayOrder: 6 },
} as const;

const END = {
  reps: { conditionTypeId: 10, conditionTypeKey: 'reps', displayOrder: 10, displayable: true },
  time: { conditionTypeId: 2, conditionTypeKey: 'time', displayOrder: 2, displayable: true },
  'lap.button': {
    conditionTypeId: 1,
    conditionTypeKey: 'lap.button',
    displayOrder: 1,
    displayable: true,
  },
  iterations: {
    conditionTypeId: 7,
    conditionTypeKey: 'iterations',
    displayOrder: 7,
    displayable: false,
  },
} as const;

export class ConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectError';
  }
}

export function fromConnect(json: unknown): Workout {
  const data = rec(json, 'Connect workout');
  const sport = rec(data.sportType, 'sportType').sportTypeKey;
  if (sport !== 'strength_training') {
    throw new ConnectError(`unsupported sport: ${String(sport)}`);
  }
  const name = data.workoutName;
  if (typeof name !== 'string' || name.trim() === '') {
    throw new ConnectError('missing workoutName');
  }
  const segments = arr(data.workoutSegments, 'workoutSegments');
  if (segments.length === 0) throw new ConnectError('no workout segments');
  const steps = segments.flatMap((segment) =>
    arr(rec(segment, 'segment').workoutSteps, 'workoutSteps').map(parseStep),
  );
  if (steps.length === 0) throw new ConnectError('no steps');
  return WorkoutSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    name: name.trim(),
    sport: 'strength',
    steps,
  });
}

export function toConnect(workout: Workout) {
  const parsed = WorkoutSchema.parse(workout);
  if (parsed.steps.length === 0) throw new ConnectError('workout has no steps');
  let order = 0;
  let groups = 0;

  function emitStep(step: WorkoutStep, childStepId: number): object {
    const stepOrder = ++order;
    if (step.kind === 'repeat') {
      const id = ++groups;
      return {
        type: 'RepeatGroupDTO',
        stepId: null,
        stepOrder,
        stepType: STEP_TYPE.repeat,
        childStepId: id,
        numberOfIterations: step.rounds,
        endConditionValue: step.rounds,
        endCondition: END.iterations,
        skipLastRestStep: false,
        smartRepeat: false,
        workoutSteps: step.steps.map((child) => emitStep(child, id)),
      };
    }
    const { duration } = step;
    const weight =
      step.kind === 'exercise' && step.target
        ? { weightValue: (step.target.kg * 1000) / GRAMS_PER_POUND, weightUnit: POUND }
        : { weightValue: null, weightUnit: null };
    return {
      type: 'ExecutableStepDTO',
      stepId: null,
      stepOrder,
      stepType: STEP_TYPE[step.kind === 'rest' ? 'rest' : 'interval'],
      childStepId,
      description: step.kind === 'exercise' ? (step.notes ?? null) : null,
      endCondition: END[duration.type === 'open' ? 'lap.button' : duration.type],
      endConditionValue:
        duration.type === 'time' ? duration.seconds : duration.type === 'reps' ? duration.reps : 0,
      category: step.kind === 'exercise' ? step.category : null,
      exerciseName: step.kind === 'exercise' ? (step.exercise ?? '') : null,
      ...weight,
    };
  }

  return {
    workoutName: parsed.name,
    sportType: SPORT,
    workoutSegments: [
      {
        segmentOrder: 1,
        sportType: SPORT,
        workoutSteps: parsed.steps.map((step) => emitStep(step, 1)),
      },
    ],
  };
}

function parseStep(raw: unknown): WorkoutStep {
  const step = rec(raw, 'step');
  if (step.type === 'RepeatGroupDTO') {
    const rounds = positive(step.numberOfIterations, 'repeat rounds', true);
    const children = arr(step.workoutSteps, 'repeat steps').map(parseStep);
    if (children.length === 0) throw new ConnectError('repeat block is empty');
    return { kind: 'repeat', rounds, steps: children };
  }
  if (step.type !== 'ExecutableStepDTO') {
    throw new ConnectError(`unsupported step: ${String(step.type)}`);
  }
  const stepType = rec(step.stepType, 'stepType').stepTypeKey;
  const duration = parseDuration(
    rec(step.endCondition, 'endCondition').conditionTypeKey,
    step.endConditionValue,
  );
  if (stepType === 'rest') {
    if (duration.type === 'reps') throw new ConnectError('rest cannot end on reps');
    return { kind: 'rest', duration };
  }
  if (stepType !== 'interval') {
    throw new ConnectError(`unsupported step type: ${String(stepType)}`);
  }
  const category = step.category;
  if (typeof category !== 'string' || category === '') {
    throw new ConnectError('exercise is missing a category');
  }
  const exercise =
    typeof step.exerciseName === 'string' && step.exerciseName !== ''
      ? step.exerciseName
      : undefined;
  const notes =
    typeof step.description === 'string' && step.description.trim() !== ''
      ? step.description
      : undefined;
  const target = parseWeight(step.weightValue, step.weightUnit);
  return {
    kind: 'exercise',
    category,
    ...(exercise ? { exercise } : {}),
    duration,
    ...(target ? { target } : {}),
    ...(notes ? { notes } : {}),
  };
}

function parseDuration(endKey: unknown, value: unknown): ExerciseStep['duration'] {
  if (endKey === 'lap.button') return { type: 'open' };
  if (endKey === 'time') return { type: 'time', seconds: positive(value, 'seconds') };
  if (endKey === 'reps') return { type: 'reps', reps: positive(value, 'reps', true) };
  throw new ConnectError(`unsupported end condition: ${String(endKey)}`);
}

function parseWeight(value: unknown, unit: unknown): ExerciseStep['target'] {
  if (typeof value !== 'number' || !(value > 0)) return undefined;
  const factor = (unit as { factor?: unknown } | null)?.factor;
  const grams = typeof factor === 'number' && factor > 0 ? factor : GRAMS_PER_POUND;
  return { type: 'weight', kg: (value * grams) / 1000 };
}

function rec(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConnectError(`${label}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function arr(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new ConnectError(`${label}: expected an array`);
  return value;
}

function positive(value: unknown, label: string, int = false): number {
  const n = Number(value);
  if (!(n > 0) || (int && !Number.isInteger(n))) {
    throw new ConnectError(`${label}: expected a positive ${int ? 'integer' : 'number'}`);
  }
  return n;
}
