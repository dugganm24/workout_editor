import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@workout-editor/core';
import { parseWorkoutsFile, serializeLibrary, serializeWorkout, workoutFileName } from './files.ts';
import { InvalidWorkoutError, UnsupportedSchemaVersionError } from './migrate.ts';
import { newWorkout } from './workouts.ts';

describe('canonical workout files', () => {
  it('round-trips a workout, keeping the name but assigning a fresh id', () => {
    const workout = { ...newWorkout('Push Day'), steps: [] };
    const [parsed] = parseWorkoutsFile(serializeWorkout(workout));

    expect(parsed?.name).toBe('Push Day');
    expect(parsed?.id).not.toBe(workout.id);
    expect({ ...parsed, id: workout.id }).toEqual(workout);
  });

  it('round-trips a whole-library bundle', () => {
    const workouts = [newWorkout('Push Day'), newWorkout('Pull Day')];
    const parsed = parseWorkoutsFile(serializeLibrary(workouts));

    expect(parsed.map((w) => w.name)).toEqual(['Push Day', 'Pull Day']);
    expect(parsed.map((w) => w.id)).not.toEqual(workouts.map((w) => w.id));
  });

  it('rejects an empty bundle', () => {
    expect(() => parseWorkoutsFile(serializeLibrary([]))).toThrow(/no workouts/);
  });

  it('rejects a bundle containing an invalid workout', () => {
    const bundle = JSON.parse(serializeLibrary([newWorkout('Good')])) as {
      workouts: unknown[];
    };
    bundle.workouts.push({ nope: true });
    expect(() => parseWorkoutsFile(JSON.stringify(bundle))).toThrow(InvalidWorkoutError);
  });

  it('slugifies the download filename', () => {
    expect(workoutFileName(newWorkout('Push Day: 5×5!'))).toBe('push-day-5-5.workout.json');
    expect(workoutFileName(newWorkout('***'))).toBe('workout.workout.json');
  });

  it('reports malformed JSON', () => {
    expect(() => parseWorkoutsFile('{ not json')).toThrow(InvalidWorkoutError);
  });

  it('reports JSON that is not a workout', () => {
    expect(() => parseWorkoutsFile('{"hello":"world"}')).toThrow(InvalidWorkoutError);
  });

  it('names the offending field in the error message', () => {
    const bad = JSON.stringify({ ...newWorkout('Bad'), name: '' });
    expect(() => parseWorkoutsFile(bad)).toThrow(/name/);
  });

  it('reports a file written by a newer schema version', () => {
    const future = JSON.stringify({ ...newWorkout('Future'), schemaVersion: SCHEMA_VERSION + 1 });
    expect(() => parseWorkoutsFile(future)).toThrow(UnsupportedSchemaVersionError);
  });
});
