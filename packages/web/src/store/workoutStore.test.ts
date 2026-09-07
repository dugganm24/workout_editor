import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDb } from '../storage/testing.ts';
import { serializeLibrary, serializeWorkout } from '../storage/files.ts';
import { newWorkout } from '../storage/workouts.ts';
import { useWorkoutStore } from './workoutStore.ts';

const store = () => useWorkoutStore.getState();

describe('workout store', () => {
  beforeEach(async () => {
    await resetDb();
    useWorkoutStore.setState({
      summaries: [],
      unreadable: [],
      currentWorkout: null,
      status: 'idle',
      error: null,
    });
  });

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
    await store().importWorkoutFile(serializeWorkout(newWorkout('Imported')));

    expect(store().summaries.map((s) => s.name)).toEqual(['Imported']);
    expect(store().error).toBeNull();
  });

  it('imports a whole-library bundle', async () => {
    await store().importWorkoutFile(
      serializeLibrary([newWorkout('Push Day'), newWorkout('Pull Day')]),
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

    await store().importWorkoutFile(JSON.stringify(bundle));

    expect(store().error).toBeTruthy();
    expect(store().summaries).toEqual([]);
  });

  it('refuses to export an empty library', async () => {
    await store().exportLibrary();
    expect(store().error).toMatch(/no workouts to export/);
  });

  it('surfaces an import error without touching the library', async () => {
    await store().importWorkoutFile('not json at all');

    expect(store().error).toMatch(/JSON/);
    expect(store().summaries).toEqual([]);
  });

  it('reports opening a workout that is gone', async () => {
    await store().openWorkout('missing');
    expect(store().error).toMatch(/no longer in your library/);
  });
});
