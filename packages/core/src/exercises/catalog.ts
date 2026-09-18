import type { ExerciseCategorySeed } from './index.js';

/**
 * The strength exercises the editor offers, keyed as Garmin Connect's workout
 * JSON expects them: an `exerciseCategory`, and an `exerciseName` within it.
 *
 * **Provisional.** These keys are written here by hand, in the shape Connect
 * uses, and cover what a first strength session needs. The golden fixtures
 * (#2) carry the keys Connect itself emits, and are what confirms them; the
 * pending check for that lives in `exercises.test.ts`.
 *
 * Deliberately not generated from Garmin's FIT SDK: its licence forbids
 * distributing derivatives under a licence that grants modification rights
 * (§2(d)), which is what committing generated enums to this MIT repo would be.
 * See docs/exercise-taxonomy.md.
 */
export const CATALOG: ExerciseCategorySeed[] = [
  {
    key: 'BENCH_PRESS',
    exercises: [
      'BARBELL_BENCH_PRESS',
      'DUMBBELL_BENCH_PRESS',
      'INCLINE_DUMBBELL_BENCH_PRESS',
      'CLOSE_GRIP_BARBELL_BENCH_PRESS',
    ],
  },
  {
    key: 'SQUAT',
    exercises: ['BARBELL_BACK_SQUAT', 'BARBELL_FRONT_SQUAT', 'GOBLET_SQUAT', 'OVERHEAD_SQUAT'],
  },
  {
    key: 'DEADLIFT',
    exercises: ['BARBELL_DEADLIFT', 'ROMANIAN_DEADLIFT', 'SUMO_DEADLIFT', 'TRAP_BAR_DEADLIFT'],
  },
  {
    key: 'ROW',
    exercises: ['BARBELL_ROW', 'DUMBBELL_ROW', 'SEATED_CABLE_ROW', 'INVERTED_ROW'],
  },
  {
    key: 'SHOULDER_PRESS',
    exercises: ['BARBELL_OVERHEAD_PRESS', 'DUMBBELL_SHOULDER_PRESS', 'ARNOLD_PRESS'],
  },
  {
    key: 'PULL_UP',
    exercises: ['PULL_UP', 'CHIN_UP', 'ASSISTED_PULL_UP'],
  },
  {
    key: 'PUSH_UP',
    exercises: ['PUSH_UP', 'WIDE_GRIP_PUSH_UP', 'DIAMOND_PUSH_UP'],
  },
  {
    key: 'CURL',
    exercises: ['BARBELL_CURL', 'DUMBBELL_CURL', 'HAMMER_CURL', 'CABLE_CURL'],
  },
  {
    key: 'TRICEPS_EXTENSION',
    exercises: ['CABLE_TRICEPS_PUSHDOWN', 'DUMBBELL_OVERHEAD_TRICEPS_EXTENSION', 'DIP'],
  },
  {
    key: 'PLANK',
    exercises: ['PLANK', 'SIDE_PLANK', 'WEIGHTED_PLANK'],
  },
  {
    key: 'LUNGE',
    exercises: ['WALKING_LUNGE', 'REVERSE_LUNGE', 'BULGARIAN_SPLIT_SQUAT'],
  },
  {
    key: 'CARRY',
    exercises: ['FARMERS_WALK', 'SUITCASE_CARRY', 'OVERHEAD_CARRY'],
  },
];
