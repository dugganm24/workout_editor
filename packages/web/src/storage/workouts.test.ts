import { describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { closeDb, DB_NAME, getDb, UPDATED_AT_INDEX, WORKOUT_STORE } from './db.ts';
import { UnsupportedSchemaVersionError } from './migrate.ts';
import {
  createWorkout,
  deleteWorkout,
  duplicateWorkout,
  getWorkout,
  listWorkouts,
  newWorkout,
  putWorkout,
  putWorkouts,
  readAllForBackup,
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

/** Writes a record straight to the store, bypassing validation. `seq` orders it. */
let rawSeq = 0;
async function putRaw(id: string, workout: unknown, seq = ++rawSeq): Promise<void> {
  const db = await getDb();
  await db.put(WORKOUT_STORE, { id, seq, updatedAt: Date.now(), workout } as never);
}

describe('workout storage', () => {
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
    await putRaw('older', workoutWithSteps('Older'), 1);
    await putRaw('newer', newWorkout('Newer'), 2);

    const { workouts } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Newer', 'Older']);
    expect(workouts[0]?.stepCount).toBe(0);
    // One repeat block holding an exercise and a rest: two steps, not one.
    expect(workouts[1]?.stepCount).toBe(2);
  });

  it('counts steps inside nested repeat blocks without multiplying rounds', async () => {
    const nested = newWorkout('Nested');
    nested.steps = [
      {
        kind: 'repeat',
        rounds: 4,
        steps: [
          { kind: 'exercise', category: 'SQUAT', duration: { type: 'reps', reps: 5 } },
          {
            kind: 'repeat',
            rounds: 2,
            steps: [{ kind: 'rest', duration: { type: 'time', seconds: 60 } }],
          },
        ],
      },
      { kind: 'rest', duration: { type: 'time', seconds: 120 } },
    ];
    await putRaw('nested', nested, 1);

    const { workouts } = await listWorkouts();
    expect(workouts[0]?.stepCount).toBe(3);
  });

  it('keeps creation order for writes inside the same millisecond', async () => {
    // Ordering comes from `seq`, so a shared timestamp cannot leave the order
    // to the random UUID primary key.
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    try {
      for (const name of ['First', 'Second', 'Third']) await createWorkout(name);
    } finally {
      now.mockRestore();
    }

    const { workouts } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Third', 'Second', 'First']);
    // ...and no timestamp had to be nudged past the wall clock to achieve it.
    expect(workouts.map((w) => w.updatedAt)).toEqual([5_000, 5_000, 5_000]);
  });

  it('orders by the database, not module state, across a reload', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    try {
      vi.resetModules();
      let storage = await import('./workouts.ts');
      for (const name of ['First', 'Second', 'Third']) await storage.createWorkout(name);

      // A reload gets fresh module state while the wall clock has barely moved.
      clock.mockReturnValue(5_001);
      vi.resetModules();
      storage = await import('./workouts.ts');
      await storage.createWorkout('After reload');

      const { workouts } = await storage.listWorkouts();
      expect(workouts.map((w) => w.name)).toEqual(['After reload', 'Third', 'Second', 'First']);
    } finally {
      clock.mockRestore();
    }
  });

  it('writes a batch in one transaction, in order', async () => {
    const written = await putWorkouts(['A', 'B', 'C'].map((n) => newWorkout(n)));
    expect(written.map((r) => r.seq)).toEqual([1, 2, 3]);
    expect((await listWorkouts()).workouts.map((w) => w.name)).toEqual(['C', 'B', 'A']);
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

  it('backfills write order for a database saved before seq existed', async () => {
    // Rebuild the v1 shape by hand: records with no `seq`, ordered by updatedAt.
    const v1 = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(WORKOUT_STORE, { keyPath: 'id' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      },
    });
    await v1.put(WORKOUT_STORE, { id: 'a', updatedAt: 1_000, workout: newWorkout('Older') });
    await v1.put(WORKOUT_STORE, { id: 'b', updatedAt: 2_000, workout: newWorkout('Newer') });
    v1.close();

    // Opening at v2 must keep both rows and their order, not hide the ones the
    // new index cannot see.
    const { workouts } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Newer', 'Older']);

    // ...and a write after the upgrade still lands on top.
    await createWorkout('Newest');
    expect((await listWorkouts()).workouts.map((w) => w.name)).toEqual([
      'Newest',
      'Newer',
      'Older',
    ]);
  });

  it('keeps unreadable records available for the backup', async () => {
    await putRaw('good', newWorkout('Good'));
    await putRaw('bad', { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' });

    const { workouts, unreadable } = await readAllForBackup();
    expect(workouts.map((w) => w.name)).toEqual(['Good']);
    // The bytes survive even though nothing can parse them.
    expect(unreadable.map((u) => u.id)).toEqual(['bad']);
    expect(unreadable[0]?.raw).toMatchObject({ id: 'bad' });
  });

  it('rejects a workout saved by a newer schema version', async () => {
    await putRaw('future', { ...newWorkout('Future'), schemaVersion: SCHEMA_VERSION + 1 });
    await expect(getWorkout('future')).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);
  });
});
