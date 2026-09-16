import type { ExerciseStep, RepeatBlock, RestStep, WorkoutStep } from '@workout-editor/core';

/** What a freshly added step contains before the user has said anything. */

/**
 * Every new exercise starts here until the taxonomy lands (#3): the model
 * requires a category, and nothing yet knows which categories exist. The
 * picker will set both fields; today's free-text box writes only `exercise`.
 */
export const PLACEHOLDER_CATEGORY = 'UNKNOWN';

/** What a step counts by until the user says otherwise; also what the editor
 *  fills in when a step is switched to that kind of duration. */
export const DEFAULT_REPS = 8;
export const DEFAULT_SECONDS = 60;

export function newExerciseStep(): ExerciseStep {
  return {
    kind: 'exercise',
    category: PLACEHOLDER_CATEGORY,
    duration: { type: 'reps', reps: DEFAULT_REPS },
  };
}

export function newRestStep(): RestStep {
  return { kind: 'rest', duration: { type: 'time', seconds: DEFAULT_SECONDS } };
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
