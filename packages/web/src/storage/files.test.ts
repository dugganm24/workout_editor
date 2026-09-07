import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from '@workout-editor/core';
import { parseWorkoutFile, serializeWorkout, workoutFileName } from './files.ts';
import { InvalidWorkoutError, UnsupportedSchemaVersionError } from './migrate.ts';
import { newWorkout } from './workouts.ts';

describe('canonical workout files', () => {
  it('round-trips a workout, keeping the name but assigning a fresh id', () => {
    const workout = { ...newWorkout('Push Day'), steps: [] };
    const parsed = parseWorkoutFile(serializeWorkout(workout));

    expect(parsed.name).toBe('Push Day');
    expect(parsed.id).not.toBe(workout.id);
    expect({ ...parsed, id: workout.id }).toEqual(workout);
  });

  it('slugifies the download filename', () => {
    expect(workoutFileName(newWorkout('Push Day: 5×5!'))).toBe('push-day-5-5.workout.json');
    expect(workoutFileName(newWorkout('***'))).toBe('workout.workout.json');
  });

  it('reports malformed JSON', () => {
    expect(() => parseWorkoutFile('{ not json')).toThrow(InvalidWorkoutError);
  });

  it('reports JSON that is not a workout', () => {
    expect(() => parseWorkoutFile('{"hello":"world"}')).toThrow(InvalidWorkoutError);
  });

  it('names the offending field in the error message', () => {
    const bad = JSON.stringify({ ...newWorkout('Bad'), name: '' });
    expect(() => parseWorkoutFile(bad)).toThrow(/name/);
  });

  it('reports a file written by a newer schema version', () => {
    const future = JSON.stringify({ ...newWorkout('Future'), schemaVersion: SCHEMA_VERSION + 1 });
    expect(() => parseWorkoutFile(future)).toThrow(UnsupportedSchemaVersionError);
  });
});
