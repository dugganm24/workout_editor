import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, WorkoutSchema } from './workout.js';

const validWorkout = {
  schemaVersion: SCHEMA_VERSION,
  id: 'w1',
  name: 'Push Day',
  sport: 'strength',
  steps: [
    {
      kind: 'repeat',
      rounds: 3,
      steps: [
        {
          kind: 'exercise',
          category: 'BENCH_PRESS',
          exercise: 'BARBELL_BENCH_PRESS',
          duration: { type: 'reps', reps: 5 },
          target: { type: 'weight', kg: 100 },
        },
        { kind: 'rest', duration: { type: 'time', seconds: 180 } },
      ],
    },
  ],
};

describe('WorkoutSchema', () => {
  it('accepts a valid strength workout with nested repeat blocks', () => {
    expect(WorkoutSchema.parse(validWorkout)).toEqual(validWorkout);
  });

  it('accepts a workout with no steps (a freshly created draft)', () => {
    expect(WorkoutSchema.safeParse({ ...validWorkout, steps: [] }).success).toBe(true);
  });

  it('rejects a repeat block with no steps', () => {
    const bad = {
      ...validWorkout,
      steps: [{ kind: 'repeat', rounds: 3, steps: [] }],
    };
    expect(WorkoutSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown schema version', () => {
    expect(WorkoutSchema.safeParse({ ...validWorkout, schemaVersion: 999 }).success).toBe(false);
  });

  it('rejects an exercise step with non-positive reps', () => {
    const bad = {
      ...validWorkout,
      steps: [
        {
          kind: 'exercise',
          category: 'SQUAT',
          duration: { type: 'reps', reps: 0 },
        },
      ],
    };
    expect(WorkoutSchema.safeParse(bad).success).toBe(false);
  });
});
