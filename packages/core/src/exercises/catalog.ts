import type { ExerciseCategorySeed } from './index.js';

/**
 * Strength exercises the editor offers, keyed as Garmin Connect's workout JSON
 * emits them: `category` plus `exerciseName` within it.
 *
 * Grown from the golden Connect fixtures. A category with an empty list is one
 * Connect used with `exerciseName: ""` (a category and no named variant).
 *
 * Not generated from Garmin's FIT SDK — see docs/exercise-taxonomy.md.
 */
export const CATALOG: ExerciseCategorySeed[] = [
  { key: 'BENCH_PRESS', exercises: ['INCLINE_DUMBBELL_BENCH_PRESS'] },
  { key: 'CALF_RAISE', exercises: [] },
  { key: 'CHOP', exercises: ['STANDING_ROTATIONAL_CHOP'] },
  { key: 'CORE', exercises: ['CABLE_CORE_PRESS', 'WEIGHTED_GHD_BACK_EXTENSIONS'] },
  { key: 'CRUNCH', exercises: ['WEIGHTED_LEG_EXTENSIONS'] },
  { key: 'CURL', exercises: ['BARBELL_BICEPS_CURL'] },
  { key: 'DEADLIFT', exercises: ['ROMANIAN_DEADLIFT'] },
  { key: 'HIP_STABILITY', exercises: ['WEIGHTED_DEAD_BUG'] },
  { key: 'LATERAL_RAISE', exercises: ['DUMBBELL_LATERAL_RAISE'] },
  { key: 'LEG_CURL', exercises: ['LEG_CURL'] },
  { key: 'LUNGE', exercises: ['BARBELL_SPLIT_SQUAT'] },
  { key: 'PLANK', exercises: ['SIDE_PLANK'] },
  { key: 'PLYO', exercises: ['BOX_JUMP'] },
  { key: 'PULL_UP', exercises: ['LAT_PULLDOWN'] },
  { key: 'ROW', exercises: ['BARBELL_ROW', 'FACE_PULL'] },
  { key: 'RUN', exercises: ['SPRINT'] },
  { key: 'SHOULDER_PRESS', exercises: [] },
  { key: 'SQUAT', exercises: ['BARBELL_BACK_SQUAT'] },
  { key: 'TRICEPS_EXTENSION', exercises: ['TRICEPS_PRESSDOWN'] },
];
