import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { closeDb, getDb, WORKOUT_STORE } from './db.ts';
import { UnsupportedSchemaVersionError } from './migrate.ts';
import { resetDb } from './testing.ts';
import {
  createWorkout,
  deleteWorkout,
  duplicateWorkout,
  getWorkout,
  listWorkouts,
  newWorkout,
  putWorkout,
} from './workouts.ts';

function workoutWithSteps(name: string): Workout {
  return {
    ...newWorkout(name),
    steps: [
      {
        kind: 'repeat',
        rounds: 3,
        steps: [
          {
            kind: 'exercise',
            category: 'SQUAT',
            duration: { type: 'reps', reps: 5 },
            target: { type: 'weight', kg: 100 },
          },
          { kind: 'rest', duration: { type: 'time', seconds: 120 } },
        ],
      },
    ],
  };
}

/** Writes a record straight to the store, bypassing validation. */
async function putRaw(id: string, workout: unknown, updatedAt = Date.now()): Promise<void> {
  const db = await getDb();
  await db.put(WORKOUT_STORE, { id, updatedAt, workout } as never);
}

describe('workout storage', () => {
  beforeEach(resetDb);

  it('round-trips a workout through IndexedDB', async () => {
    const workout = workoutWithSteps('Leg Day');
    await putWorkout(workout);
    expect(await getWorkout(workout.id)).toEqual(workout);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await getWorkout('nope')).toBeUndefined();
  });

  it('creates an empty draft workout', async () => {
    const workout = await createWorkout('Draft');
    expect(workout.steps).toEqual([]);
    expect(workout.schemaVersion).toBe(SCHEMA_VERSION);
    expect((await listWorkouts()).workouts).toHaveLength(1);
  });

  it('lists workouts newest first with step counts', async () => {
    await putRaw('older', workoutWithSteps('Older'), 1_000);
    await putRaw('newer', newWorkout('Newer'), 2_000);

    const { workouts } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Newer', 'Older']);
    expect(workouts[0]?.stepCount).toBe(0);
    expect(workouts[1]?.stepCount).toBe(1);
  });

  it('duplicates under a new id without touching the original', async () => {
    const original = await createWorkout('Push Day');
    const copy = await duplicateWorkout(original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Push Day (copy)');
    expect(await getWorkout(original.id)).toEqual(original);
    expect((await listWorkouts()).workouts).toHaveLength(2);
  });

  it('deletes a workout', async () => {
    const workout = await createWorkout('Temporary');
    await deleteWorkout(workout.id);
    expect(await getWorkout(workout.id)).toBeUndefined();
    expect((await listWorkouts()).workouts).toEqual([]);
  });

  it('survives a page reload', async () => {
    const workout = workoutWithSteps('Leg Day');
    await putWorkout(workout);

    // A reload drops the cached connection but not the database itself.
    await closeDb();

    expect(await getWorkout(workout.id)).toEqual(workout);
    expect((await listWorkouts()).workouts.map((w) => w.name)).toEqual(['Leg Day']);
  });

  it('hides a corrupt record instead of blanking the library', async () => {
    await putRaw('good', newWorkout('Good'));
    await putRaw('bad', { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' });

    const { workouts, unreadable } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Good']);
    expect(unreadable.map((u) => u.id)).toEqual(['bad']);
  });

  it('rejects a workout saved by a newer schema version', async () => {
    await putRaw('future', { ...newWorkout('Future'), schemaVersion: SCHEMA_VERSION + 1 });
    await expect(getWorkout('future')).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
  });
});
