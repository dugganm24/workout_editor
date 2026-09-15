import type { ExerciseStep, RepeatBlock, RestStep, WorkoutStep } from '@workout-editor/core';

/** What a freshly added step contains before the user has said anything. */

/**
 * Every new exercise starts here until the taxonomy lands (#3): the model
 * requires a category, and nothing yet knows which categories exist. The
 * picker will set both fields; today's free-text box writes only `exercise`.
 */
export const PLACEHOLDER_CATEGORY = 'UNKNOWN';

export function newExerciseStep(): ExerciseStep {
  return {
    kind: 'exercise',
    category: PLACEHOLDER_CATEGORY,
    duration: { type: 'reps', reps: 8 },
  };
}

export function newRestStep(): RestStep {
  return { kind: 'rest', duration: { type: 'time', seconds: 60 } };
}

export function newRepeatBlock(): RepeatBlock {
  // Never empty: RepeatBlockSchema requires a step, and an empty block would
  // fail to save the moment it was added.
  return { kind: 'repeat', rounds: 3, steps: [newExerciseStep()] };
}

/** "Add another of these" after Enter: same kind, fresh values. */
export function stepLike(step: WorkoutStep): WorkoutStep {
  if (step.kind === 'rest') return newRestStep();
  if (step.kind === 'repeat') return newRepeatBlock();
  return newExerciseStep();
}
