import { CATALOG } from './catalog.js';

/**
 * The exercise taxonomy: the categories and exercise names Garmin Connect
 * understands, and the lookups the editor's picker is built on.
 *
 * Keys are Connect's own — `BENCH_PRESS`, `BARBELL_ROW` — and travel into
 * `ExerciseStep.category` / `.exercise` untouched, so converting a workout
 * needs no second mapping. Display names are derived from the keys rather than
 * stored beside them: one source of truth, and a key cannot be added to the
 * catalog without getting a name.
 */

/** What `catalog.ts` writes down: a category, and the exercises within it. */
export interface ExerciseCategorySeed {
  key: string;
  exercises: string[];
}

export interface Exercise {
  /** Connect's `exerciseName`, e.g. `BARBELL_ROW`. */
  key: string;
  /** Connect's `category` for it, e.g. `ROW`. */
  category: string;
  /** For people: "Barbell Bench Press". */
  name: string;
}

export interface ExerciseCategory {
  key: string;
  name: string;
  exercises: Exercise[];
}

/** The shape a key has to be in to reach Connect intact. Leading `_` appears on numbered names. */
const KEY = /^_?[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

export function isExerciseKey(key: string): boolean {
  return KEY.test(key);
}

/** `BARBELL_BENCH_PRESS` → "Barbell Bench Press". */
export function displayName(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const EXERCISE_CATEGORIES: ExerciseCategory[] = CATALOG.map((seed) => ({
  key: seed.key,
  name: displayName(seed.key),
  exercises: seed.exercises.map((key) => ({ key, category: seed.key, name: displayName(key) })),
}));

const byCategory = new Map(EXERCISE_CATEGORIES.map((category) => [category.key, category]));

export function findCategory(key: string): ExerciseCategory | undefined {
  return byCategory.get(key);
}

/**
 * The exercise a step names. Looked up within its category, because Connect
 * scopes exercise names to one: the same name can sit under more than one.
 */
export function findExercise(category: string, key: string): Exercise | undefined {
  return byCategory.get(category)?.exercises.find((exercise) => exercise.key === key);
}

export function allExercises(): Exercise[] {
  return EXERCISE_CATEGORIES.flatMap((category) => category.exercises);
}

/**
 * Search for the picker: every word typed has to appear somewhere in the
 * exercise, so "bench dumbbell" finds the dumbbell bench press whichever order
 * it is typed in. Words that start a word in the name rank first — typing
 * "row" wants "Row" ahead of "Narrow grip" — and ties keep catalog order.
 */
export function searchExercises(query: string, limit = 20): Exercise[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const exercises = allExercises();
  if (words.length === 0) return exercises.slice(0, limit);

  return exercises
    .map((exercise, index) => {
      const haystack = `${exercise.name} ${exercise.category}`.toLowerCase();
      const parts = haystack.split(/[\s_]+/);
      return {
        exercise,
        index,
        matches: words.every((word) => haystack.includes(word)),
        leading: words.filter((word) => parts.some((part) => part.startsWith(word))).length,
      };
    })
    .filter((entry) => entry.matches)
    .sort((a, b) => b.leading - a.leading || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.exercise);
}
