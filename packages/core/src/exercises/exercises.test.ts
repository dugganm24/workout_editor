import { describe, expect, it } from 'vitest';
import {
  allExercises,
  displayName,
  EXERCISE_CATEGORIES,
  findCategory,
  findExercise,
  isExerciseKey,
  searchExercises,
} from './index.js';

describe('exercise taxonomy', () => {
  it('keys every category and exercise the way Connect does', () => {
    for (const category of EXERCISE_CATEGORIES) {
      expect(isExerciseKey(category.key), category.key).toBe(true);
      expect(category.exercises.length).toBeGreaterThan(0);
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
    expect(findExercise('BENCH_PRESS', 'BARBELL_BENCH_PRESS')).toMatchObject({
      name: 'Barbell Bench Press',
      category: 'BENCH_PRESS',
    });
    // A name belongs to a category: the same one under another does not resolve.
    expect(findExercise('SQUAT', 'BARBELL_BENCH_PRESS')).toBeUndefined();
    expect(findExercise('NOT_A_CATEGORY', 'BARBELL_BENCH_PRESS')).toBeUndefined();
    expect(findCategory('SQUAT')?.exercises.length).toBeGreaterThan(0);
    expect(findCategory('NOT_A_CATEGORY')).toBeUndefined();
  });

  describe('search', () => {
    const keys = (query: string, limit?: number) =>
      searchExercises(query, limit).map((exercise) => exercise.key);

    it('takes the words in any order, and matches the category too', () => {
      expect(keys('bench dumbbell')).toContain('DUMBBELL_BENCH_PRESS');
      expect(keys('dumbbell bench')).toContain('DUMBBELL_BENCH_PRESS');
      // "squat" is the category of the goblet squat as well as part of its name.
      expect(keys('goblet squat')).toEqual(['GOBLET_SQUAT']);
    });

    it('puts what starts with the word first', () => {
      const [first] = keys('press');
      expect(first).toBe('BARBELL_BENCH_PRESS');
      expect(keys('curl')[0]).toBe('BARBELL_CURL');
    });

    it('finds nothing rather than everything for a word no exercise has', () => {
      expect(keys('kettlebell swing')).toEqual([]);
    });

    it('offers the whole catalog for an empty query, up to the limit', () => {
      expect(searchExercises('', 5)).toHaveLength(5);
      expect(searchExercises('  ')).toHaveLength(20);
      expect(keys('press', 2)).toHaveLength(2);
    });
  });

  // Needs the golden fixtures (#2): they carry the keys Connect itself writes,
  // which is what turns this catalog from plausible into correct.
  it.todo('resolves every exerciseCategory and exerciseName seen in the fixtures');
});
