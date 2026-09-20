import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, toConnect, type Workout } from '@workout-editor/core';
import {
  parseWorkoutsFile,
  serializeConnect,
  serializeLibrary,
  serializeWorkout,
  workoutFileName,
} from './files.ts';
import { InvalidWorkoutError, UnsupportedSchemaVersionError } from './migrate.ts';
import { newWorkout } from './workouts.ts';

const squats: Workout = {
  ...newWorkout('Leg Day'),
  steps: [
    {
      kind: 'exercise',
      category: 'SQUAT',
      exercise: 'BARBELL_BACK_SQUAT',
      duration: { type: 'reps', reps: 5 },
      target: { type: 'weight', kg: 100 },
    },
    { kind: 'rest', duration: { type: 'time', seconds: 90 } },
  ],
};

describe('Garmin Connect files', () => {
  it('exports the converter output verbatim, under a plain .json name', () => {
    expect(JSON.parse(serializeConnect(squats))).toEqual(toConnect(squats));
    expect(workoutFileName(squats, '.json')).toBe('leg-day.json');
  });

  it('imports a Connect file as one workout to open', () => {
    const { workouts, unreadable, source } = parseWorkoutsFile(serializeConnect(squats));
    expect(source).toBe('connect');
    expect(unreadable).toEqual([]);
    expect(workouts.map((w) => ({ name: w.name, steps: w.steps }))).toEqual([
      { name: 'Leg Day', steps: squats.steps },
    ]);
  });

  it('explains a Connect file it cannot convert', () => {
    const running = { ...toConnect(squats), sportType: { sportTypeKey: 'running' } };
    expect(() => parseWorkoutsFile(JSON.stringify(running))).toThrow(InvalidWorkoutError);
    expect(() => parseWorkoutsFile(JSON.stringify(running))).toThrow(
      /Garmin Connect.*unsupported sport: running/,
    );
  });
});

describe('canonical workout files', () => {
  it('round-trips a workout, keeping the name but assigning a fresh id', () => {
    const workout = { ...newWorkout('Push Day'), steps: [] };
    const [parsed] = parseWorkoutsFile(serializeWorkout(workout)).workouts;

    expect(parsed?.name).toBe('Push Day');
    expect(parsed?.id).not.toBe(workout.id);
    expect({ ...parsed, id: workout.id }).toEqual(workout);
  });

  it('round-trips a whole-library bundle', () => {
    const workouts = [newWorkout('Push Day'), newWorkout('Pull Day')];
    const { workouts: parsed } = parseWorkoutsFile(serializeLibrary(workouts));

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

  it('round-trips records it cannot parse, instead of dropping them', () => {
    const corrupt = { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' };
    const file = serializeLibrary([], [{ id: 'bad', reason: 'Not a valid workout', raw: corrupt }]);

    // A library of nothing but corrupt records still produces a usable backup.
    const { workouts, unreadable } = parseWorkoutsFile(file);
    expect(workouts).toEqual([]);
    expect(unreadable).toEqual([corrupt]);
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
