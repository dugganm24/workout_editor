import type { ExerciseCategorySeed } from './index.js';
import exercises from './connect-exercises.json' with { type: 'json' };

/**
 * Strength exercises the editor offers, keyed as Garmin Connect's workout JSON
 * emits them: `category` plus `exerciseName` within it.
 *
 * Regenerated from Connect's public Exercises.json
 * (`node packages/core/scripts/generate-catalog.mjs`). Not the FIT SDK —
 * see docs/exercise-taxonomy.md.
 */
export const CATALOG: ExerciseCategorySeed[] = Object.entries(exercises).map(([key, names]) => ({
  key,
  exercises: names,
}));
