import { describe, expect, it } from 'vitest';
// Add an import when a new Connect fixture lands.
import day1 from '../../test/fixtures/connect/strength-day1-upper.json' with { type: 'json' };
import day2 from '../../test/fixtures/connect/strength-day2-lower.json' with { type: 'json' };
import day4 from '../../test/fixtures/connect/strength-day4-lower.json' with { type: 'json' };
import {
  allExercises,
  displayName,
  EXERCISE_CATEGORIES,
  findCategory,
  findExercise,
  isExerciseKey,
  searchExercises,
} from './index.js';

function fixturePairs(): { category: string; exerciseName: string }[] {
  const seen = new Map<string, { category: string; exerciseName: string }>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const step = value as Record<string, unknown>;
    if (typeof step.category === 'string') {
      const exerciseName = typeof step.exerciseName === 'string' ? step.exerciseName : '';
      seen.set(`${step.category}\0${exerciseName}`, { category: step.category, exerciseName });
    }
    for (const child of Object.values(step)) walk(child);
  };
  for (const fixture of [day1, day2, day4]) walk(fixture);
  return [...seen.values()];
}

describe('exercise taxonomy', () => {
  it('keys every category and named exercise the way Connect does', () => {
    for (const category of EXERCISE_CATEGORIES) {
      expect(isExerciseKey(category.key), category.key).toBe(true);
      for (const exercise of category.exercises) {
        expect(isExerciseKey(exercise.key), exercise.key).toBe(true);
        expect(exercise.category).toBe(category.key);
      }
    }
  });

  it('never lists a category or an exercise within it twice', () => {
    const categories = EXERCISE_CATEGORIES.map((category) => category.key);
    expect(new Set(categories).size).toBe(categories.length);

    for (const category of EXERCISE_CATEGORIES) {
      const keys = category.exercises.map((exercise) => exercise.key);
      expect(new Set(keys).size, category.key).toBe(keys.length);
    }
  });

  it('names a key the way it would be said out loud', () => {
    expect(displayName('BARBELL_BENCH_PRESS')).toBe('Barbell Bench Press');
    expect(displayName('PLANK')).toBe('Plank');
    // Every exercise has one, because it is derived rather than written twice.
    expect(allExercises().every((exercise) => exercise.name.length > 0)).toBe(true);
  });

  it('rejects a key Connect would not understand', () => {
    expect(isExerciseKey('BARBELL_BENCH_PRESS')).toBe(true);
    expect(isExerciseKey('Barbell Bench Press')).toBe(false);
    expect(isExerciseKey('BARBELL__BENCH')).toBe(false);
    expect(isExerciseKey('_BENCH')).toBe(false);
    expect(isExerciseKey('')).toBe(false);
  });

  it('looks an exercise up within its own category', () => {
    expect(findExercise('BENCH_PRESS', 'INCLINE_DUMBBELL_BENCH_PRESS')).toMatchObject({
      name: 'Incline Dumbbell Bench Press',
      category: 'BENCH_PRESS',
    });
    // A name belongs to a category: the same one under another does not resolve.
    expect(findExercise('SQUAT', 'INCLINE_DUMBBELL_BENCH_PRESS')).toBeUndefined();
    expect(findExercise('NOT_A_CATEGORY', 'INCLINE_DUMBBELL_BENCH_PRESS')).toBeUndefined();
    expect(findCategory('SQUAT')?.exercises.length).toBeGreaterThan(0);
    expect(findCategory('NOT_A_CATEGORY')).toBeUndefined();
  });

  it('resolves every category and exerciseName seen in the fixtures', () => {
    const pairs = fixturePairs();
    expect(pairs.length).toBeGreaterThan(0);
    for (const { category, exerciseName } of pairs) {
      expect(findCategory(category), category).toBeDefined();
      if (exerciseName === '') continue;
      expect(findExercise(category, exerciseName), `${category}/${exerciseName}`).toMatchObject({
        key: exerciseName,
        category,
      });
    }
  });

  describe('search', () => {
    const keys = (query: string, limit?: number) =>
      searchExercises(query, limit).map((exercise) => exercise.key);

    it('takes the words in any order, and matches the category too', () => {
      expect(keys('bench dumbbell')).toContain('INCLINE_DUMBBELL_BENCH_PRESS');
      expect(keys('dumbbell bench')).toContain('INCLINE_DUMBBELL_BENCH_PRESS');
      // "row" is FACE_PULL's category, not part of its name.
      expect(keys('face pull row')).toEqual(['FACE_PULL']);
    });

    it('puts what starts with the word first', () => {
      const [first] = keys('press');
      expect(first).toBe('INCLINE_DUMBBELL_BENCH_PRESS');
      expect(keys('curl')[0]).toBe('BARBELL_BICEPS_CURL');
    });

    it('finds nothing rather than everything for a word no exercise has', () => {
      expect(keys('kettlebell swing')).toEqual([]);
    });

    it('offers the whole catalog for an empty query, up to the limit', () => {
      expect(searchExercises('', 5)).toHaveLength(5);
      expect(searchExercises('  ')).toHaveLength(Math.min(20, allExercises().length));
      expect(keys('press', 2)).toHaveLength(2);
    });
  });
});
