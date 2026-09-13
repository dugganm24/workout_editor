import { describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { closeDb, getDb, SEQ_INDEX, WORKOUT_STORE } from './db.ts';
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

  it('hides corrupt records instead of blanking the library, newest first', async () => {
    const corrupt = { schemaVersion: SCHEMA_VERSION, sport: 'strength' };
    await putRaw('older-bad', { ...corrupt, id: 'older-bad' });
    await putRaw('good', newWorkout('Good'));
    await putRaw('newer-bad', { ...corrupt, id: 'newer-bad' });

    const { workouts, unreadable } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Good']);
    // Shown directly above the workout list, so ordered the same way.
    expect(unreadable.map((u) => u.id)).toEqual(['newer-bad', 'older-bad']);
  });

  it('restores a whole-library backup in the order it was taken', async () => {
    for (const name of ['A', 'B', 'C']) await createWorkout(name);
    expect((await listWorkouts()).workouts.map((w) => w.name)).toEqual(['C', 'B', 'A']);

    const backup = await readAllForBackup();
    for (const { id } of (await listWorkouts()).workouts) await deleteWorkout(id);

    await putWorkouts(backup.workouts);
    // Every restored record shares one `updatedAt`, so a backup handed over
    // newest-first would come back upside down with nothing left to sort by.
    expect((await listWorkouts()).workouts.map((w) => w.name)).toEqual(['C', 'B', 'A']);
  });

  it('restores unreadable payloads below the workouts that can be shown', async () => {
    await putRaw('bad', { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' });
    await createWorkout('Readable');

    const backup = await readAllForBackup();
    for (const { id } of (await listWorkouts()).workouts) await deleteWorkout(id);
    await deleteWorkout('bad');

    await putWorkouts(
      backup.workouts,
      backup.unreadable.map((u) => u.raw),
    );

    const { workouts, unreadable } = await listWorkouts();
    expect(workouts.map((w) => w.name)).toEqual(['Readable']);
    expect(unreadable).toHaveLength(1);

    // The restored payload renders no row of its own, so a higher `seq` than
    // the real workouts would push the whole library down behind nothing.
    const db = await getDb();
    const rows = await db.getAllFromIndex(WORKOUT_STORE, SEQ_INDEX);
    const seqOf = (id?: string) => rows.find((row) => row.id === id)?.seq;
    expect(seqOf(unreadable[0]?.id)).toBeLessThan(seqOf(workouts[0]?.id) ?? 0);
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
