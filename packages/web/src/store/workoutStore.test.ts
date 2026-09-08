import { describe, expect, it, vi } from 'vitest';
import { SCHEMA_VERSION } from '@workout-editor/core';
import { serializeLibrary, serializeWorkout } from '../storage/files.ts';
import * as storage from '../storage/workouts.ts';
import { newWorkout } from '../storage/workouts.ts';
import { useWorkoutStore } from './workoutStore.ts';

const store = () => useWorkoutStore.getState();

/** The store reads a file through a thunk; tests hand it the text directly. */
const asFile = (text: string) => () => Promise.resolve(text);

describe('workout store', () => {
  it('creates a workout, opens it, and lists it', async () => {
    await store().createWorkout('Push Day');

    expect(store().currentWorkout?.name).toBe('Push Day');
    expect(store().summaries.map((s) => s.name)).toEqual(['Push Day']);
    expect(store().status).toBe('ready');
  });

  it('renames the open workout and the summary together', async () => {
    await store().createWorkout('Push Day');
    const id = store().currentWorkout!.id;

    await store().renameWorkout(id, '  Pull Day  ');

    expect(store().currentWorkout?.name).toBe('Pull Day');
    expect(store().summaries[0]?.name).toBe('Pull Day');
  });

  it('does not reorder the library when a rename changes nothing', async () => {
    // Pin the clock: two creates in the same millisecond would tie on updatedAt.
    const now = vi.spyOn(Date, 'now');
    try {
      now.mockReturnValue(1_000);
      await store().createWorkout('Older');
      const older = store().currentWorkout!.id;

      now.mockReturnValue(2_000);
      await store().createWorkout('Newer');
      expect(store().summaries.map((s) => s.name)).toEqual(['Newer', 'Older']);

      // Opening the rename field and confirming without editing must be inert.
      now.mockReturnValue(3_000);
      await store().renameWorkout(older, 'Older');
      expect(store().summaries.map((s) => s.name)).toEqual(['Newer', 'Older']);

      // A real rename does move it to the top.
      await store().renameWorkout(older, 'Renamed');
      expect(store().summaries.map((s) => s.name)).toEqual(['Renamed', 'Newer']);
    } finally {
      now.mockRestore();
    }
  });

  it('refuses a blank name', async () => {
    await store().createWorkout('Push Day');
    await store().renameWorkout(store().currentWorkout!.id, '   ');

    expect(store().error).toMatch(/needs a name/);
    expect(store().summaries[0]?.name).toBe('Push Day');
  });

  it('duplicates without changing which workout is open', async () => {
    await store().createWorkout('Push Day');
    const original = store().currentWorkout!;

    await store().duplicateWorkout(original.id);

    expect(store().summaries).toHaveLength(2);
    expect(store().currentWorkout?.id).toBe(original.id);
  });

  it('closes the open workout when it is deleted', async () => {
    await store().createWorkout('Push Day');
    await store().deleteWorkout(store().currentWorkout!.id);

    expect(store().currentWorkout).toBeNull();
    expect(store().summaries).toEqual([]);
  });

  it('closeWorkout returns to the library without deleting', async () => {
    await store().createWorkout('Push Day');
    store().closeWorkout();

    expect(store().currentWorkout).toBeNull();
    expect(store().summaries).toHaveLength(1);
  });

  it('imports a backup file into the library', async () => {
    await store().importWorkoutFile(asFile(serializeWorkout(newWorkout('Imported'))));

    expect(store().summaries.map((s) => s.name)).toEqual(['Imported']);
    expect(store().error).toBeNull();
  });

  it('imports a whole-library bundle', async () => {
    await store().importWorkoutFile(
      asFile(serializeLibrary([newWorkout('Push Day'), newWorkout('Pull Day')])),
    );

    expect(
      store()
        .summaries.map((s) => s.name)
        .sort(),
    ).toEqual(['Pull Day', 'Push Day']);
  });

  it('leaves the library untouched when one entry in a bundle is bad', async () => {
    const bundle = JSON.parse(serializeLibrary([newWorkout('Good')])) as { workouts: unknown[] };
    bundle.workouts.push({ nope: true });

    await store().importWorkoutFile(asFile(JSON.stringify(bundle)));

    expect(store().error).toBeTruthy();
    expect(store().summaries).toEqual([]);
  });

  it('refuses to export an empty library', async () => {
    await store().exportLibrary();
    expect(store().error).toMatch(/no workouts to export/);
  });

  it('surfaces an import error without touching the library', async () => {
    await store().importWorkoutFile(asFile('not json at all'));

    expect(store().error).toMatch(/JSON/);
    expect(store().summaries).toEqual([]);
  });

  it('writes nothing when a write fails part-way through a bundle', async () => {
    const bundle = serializeLibrary(['A', 'B', 'C'].map((n) => newWorkout(n)));
    const spy = vi
      .spyOn(storage, 'putWorkouts')
      .mockRejectedValueOnce(new Error('QuotaExceededError'));

    await store().importWorkoutFile(asFile(bundle));
    spy.mockRestore();

    // All or nothing: a torn import used to leave the first entries behind.
    expect(store().summaries).toEqual([]);
    expect(store().error).toBeTruthy();
  });

  it('runs actions in dispatch order, so each sees the last one is writes', async () => {
    await store().createWorkout('Push Day');
    const id = store().summaries[0]?.id ?? '';

    // The shape of blurring a rename and clicking Duplicate in one gesture.
    await Promise.all([store().renameWorkout(id, 'Pull Day'), store().duplicateWorkout(id)]);

    expect(
      store()
        .summaries.map((s) => s.name)
        .sort(),
    ).toEqual(['Pull Day', 'Pull Day (copy)']);
  });

  it('keeps an error a concurrent success would have wiped', async () => {
    await store().createWorkout('Push Day');
    const id = store().summaries[0]?.id ?? '';

    await Promise.all([store().renameWorkout(id, '   '), store().duplicateWorkout(id)]);

    // The duplicate succeeded, but the rename's complaint is still on screen.
    expect(store().error).toBe('A workout needs a name.');
    expect(store().summaries).toHaveLength(2);
  });

  it('restores records a backup preserved but cannot parse', async () => {
    const corrupt = { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' };
    const file = serializeLibrary(
      [newWorkout('Good')],
      [{ id: 'bad', reason: 'Not a valid workout', raw: corrupt }],
    );

    await store().importWorkoutFile(asFile(file));

    expect(store().summaries.map((s) => s.name)).toEqual(['Good']);
    // Still unreadable, but present rather than silently dropped.
    expect(store().unreadable).toHaveLength(1);
  });

  it('clears a stale error once an export succeeds', async () => {
    await store().createWorkout('Push Day');
    await store().renameWorkout(store().summaries[0]?.id ?? '', '   ');
    expect(store().error).toBe('A workout needs a name.');

    await store().exportLibrary();
    expect(store().error).toBeNull();
  });

  it('reports a file it could not read instead of failing silently', async () => {
    await store().importWorkoutFile(() =>
      Promise.reject(new DOMException('permission denied', 'NotReadableError')),
    );

    expect(store().error).toMatch(/could not be read/);
    expect(store().summaries).toEqual([]);
  });

  it('reports opening a workout that is gone', async () => {
    await store().openWorkout('missing');
    expect(store().error).toMatch(/no longer in your library/);
  });
});
