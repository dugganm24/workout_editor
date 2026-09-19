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
      expect(keys('face pull row')).toContain('FACE_PULL');
    });

    it('puts what starts with the word first', () => {
      const ranked = searchExercises('press', allExercises().length);
      const leading = (exercise: { name: string; category: string }) =>
        `${exercise.name} ${exercise.category}`
          .toLowerCase()
          .split(/[\s_]+/)
          .some((part) => part.startsWith('press'));
      expect(leading(ranked[0]!)).toBe(true);
      const scores = ranked.map((exercise) => Number(leading(exercise)));
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    });

    it('finds nothing rather than everything for a word no exercise has', () => {
      expect(keys('xyzzyfnord')).toEqual([]);
    });

    it('offers the whole catalog for an empty query, up to the limit', () => {
      expect(searchExercises('', 5)).toHaveLength(5);
      expect(searchExercises('  ')).toHaveLength(Math.min(20, allExercises().length));
      expect(keys('press', 2)).toHaveLength(2);
    });
  });
});
