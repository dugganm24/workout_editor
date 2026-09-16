import { describe, expect, it, vi } from 'vitest';
import { insertStep, SCHEMA_VERSION, type WorkoutStep } from '@workout-editor/core';
import { serializeLibrary, serializeWorkout } from '../storage/files.ts';
import * as storage from '../storage/workouts.ts';
import { newWorkout } from '../storage/workouts.ts';
import { useWorkoutStore } from './workoutStore.ts';

const store = () => useWorkoutStore.getState();

/** Safety copies of unsaved edits currently in `localStorage`, from any tab. */
const unsavedKeys = () =>
  Object.keys(localStorage).filter((key) => key.startsWith('workout-editor:unsaved:'));

/** A safety copy as a tab that closed before writing it would have left it (see `storage/unsaved.ts`). */
function leaveCopyFromClosedTab(
  workout: { id?: string; [field: string]: unknown },
  baseSeq: number,
) {
  localStorage.setItem(
    `workout-editor:unsaved:${workout.id ?? 'broken'}`,
    JSON.stringify({ baseSeq, version: 1, workout }),
  );
}

/** The write order of a stored workout, which its safety copy is measured against. */
const storedSeq = async (id: string) => (await storage.getStoredWorkout(id))?.seq ?? 0;

/** The store reads a file through a thunk; tests hand it the text directly. */
const asFile = (text: string) => () => Promise.resolve(text);

describe('workout store', () => {
  const squat: WorkoutStep = {
    kind: 'exercise',
    category: 'UNKNOWN',
    exercise: 'Squat',
    duration: { type: 'reps', reps: 5 },
  };

  /** Adds one step to the open workout, the way an editor row does. */
  const addStep = (step: WorkoutStep = squat) =>
    store().editSteps((steps) => insertStep(steps, [steps.length], step));

  describe('step editing', () => {
    it('shows the edit immediately and saves it after the pause', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      try {
        await store().createWorkout('Push Day');
        const id = store().currentWorkout!.id;

        addStep();
        // On screen straight away...
        expect(store().currentWorkout?.steps).toHaveLength(1);
        // ...and not yet written, so a burst of typing is one write.
        expect((await storage.getWorkout(id))?.steps).toEqual([]);

        // Only the timer can write it: nothing here calls flushSteps.
        await vi.advanceTimersByTimeAsync(500);
        vi.useRealTimers();
        await vi.waitFor(async () => expect((await storage.getWorkout(id))?.steps).toHaveLength(1));
      } finally {
        vi.useRealTimers();
      }
    });

    it('collapses a burst of edits into a single write', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const put = vi.spyOn(storage, 'putWorkout');
      try {
        await store().createWorkout('Push Day');
        put.mockClear();

        for (let i = 0; i < 5; i++) addStep();
        await vi.advanceTimersByTimeAsync(500);
        vi.useRealTimers();
        await vi.waitFor(() => expect(put).toHaveBeenCalled());

        expect(put).toHaveBeenCalledTimes(1);
        expect(put.mock.calls[0]?.[0].steps).toHaveLength(5);
      } finally {
        put.mockRestore();
        vi.useRealTimers();
      }
    });

    it("updates the saved workout's summary without re-reading the library", async () => {
      await store().createWorkout('Older');
      await store().createWorkout('Push Day');
      const older = store().summaries.find((s) => s.name === 'Older')!;
      await store().openWorkout(older.id);
      const list = vi.spyOn(storage, 'listWorkouts');
      try {
        addStep();
        await store().flushSteps();

        expect(list).not.toHaveBeenCalled();
        // Newest write first, as a full reload would order it.
        expect(store().summaries.map((s) => [s.name, s.stepCount])).toEqual([
          ['Older', 1],
          ['Push Day', 0],
        ]);
      } finally {
        list.mockRestore();
      }
    });

    it('writes a pending edit before an action that reads the workout back', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      addStep();

      // Duplicate re-reads from storage; without the flush it would copy the
      // workout as it was before the last keystroke.
      await store().duplicateWorkout(id);

      const copy = store().summaries.find((s) => s.name === 'Push Day (copy)');
      expect(copy?.stepCount).toBe(1);
    });

    it('writes a pending edit when the workout is closed', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      addStep();

      await store().closeWorkout();

      expect(store().currentWorkout).toBeNull();
      expect((await storage.getWorkout(id))?.steps).toHaveLength(1);
    });

    it('keeps a failed save pending, and the workout open, until it is written', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      addStep();
      const put = vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));
      try {
        await store().closeWorkout();
        expect(store().saveError).toBe('disk full');
        // Leaving would have thrown away the only copy of the edit.
        expect(store().currentWorkout?.steps).toHaveLength(1);

        // Editing on does not dismiss it: nothing has been saved yet.
        addStep();
        expect(store().saveError).toBe('disk full');
        await store().flushSteps();
        expect(store().saveError).toBe('disk full');

        // The edits were not dropped with the failed writes: leaving retries them.
        put.mockRestore();
        await store().closeWorkout();
        expect(store().currentWorkout).toBeNull();
        expect(store().saveError).toBeNull();
        expect((await storage.getWorkout(id))?.steps).toHaveLength(2);
      } finally {
        put.mockRestore();
      }
    });

    it('discards edits that could not be saved, when asked to', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      const put = vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));
      try {
        addStep();
        await store().flushSteps();
        expect(store().saveError).toBe('disk full');

        store().discardChanges();

        expect(store().currentWorkout).toBeNull();
        expect(store().saveError).toBeNull();
        expect(unsavedKeys()).toEqual([]);
        put.mockRestore();
        // Nothing is left to be retried.
        await store().flushSteps();
        expect((await storage.getWorkout(id))?.steps).toEqual([]);
      } finally {
        put.mockRestore();
      }
    });

    it('starts the write as soon as the page is hidden', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      try {
        await store().createWorkout('Push Day');
        const id = store().currentWorkout!.id;
        addStep();
        // Dropping the fake clock discards the autosave timer, so only the
        // hide event can write the edit.
        vi.useRealTimers();
        document.dispatchEvent(new Event('visibilitychange'));

        await vi.waitFor(async () => expect((await storage.getWorkout(id))?.steps).toHaveLength(1));
      } finally {
        hidden.mockRestore();
        vi.useRealTimers();
      }
    });

    it('keeps a safety copy of each edit until that version is saved', async () => {
      await store().createWorkout('Push Day');
      addStep();
      // Written with the edit, not later: a tab can close at any moment.
      expect(unsavedKeys()).toHaveLength(1);

      // A newer edit made while the older one is being written keeps its copy.
      const realPut = storage.putWorkout;
      const put = vi.spyOn(storage, 'putWorkout').mockImplementationOnce((workout) => {
        addStep();
        return realPut(workout);
      });
      try {
        await store().flushSteps();
        expect(unsavedKeys()).toHaveLength(1);
      } finally {
        put.mockRestore();
      }

      await store().flushSteps();
      expect(unsavedKeys()).toEqual([]);
    });

    it('leaves copies of edits this tab still holds to its own autosave', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      addStep();

      await store().loadLibrary();

      expect(unsavedKeys()).toHaveLength(1);
      expect((await storage.getWorkout(id))?.steps).toEqual([]);
    });

    it('writes an edit a closed tab left behind when the library next loads', async () => {
      const workout = await storage.createWorkout('Push Day');
      leaveCopyFromClosedTab({ ...workout, steps: [squat] }, await storedSeq(workout.id));

      await store().loadLibrary();

      expect((await storage.getWorkout(workout.id))?.steps).toEqual([squat]);
      expect(store().summaries.map((s) => [s.name, s.stepCount])).toEqual([['Push Day', 1]]);
      expect(unsavedKeys()).toEqual([]);
      expect(store().error).toBeNull();
    });

    it('drops a left-behind edit whose workout has been written since, and says so', async () => {
      const workout = await storage.createWorkout('Push Day');
      // Made against an earlier version than the one stored: writing it back
      // would undo whatever was saved in between.
      leaveCopyFromClosedTab({ ...workout, steps: [squat] }, (await storedSeq(workout.id)) - 1);

      await store().loadLibrary();

      expect((await storage.getWorkout(workout.id))?.steps).toEqual([]);
      expect(store().summaries.map((s) => s.name)).toEqual(['Push Day']);
      expect(store().error).toMatch(/has been saved since/);
      expect(unsavedKeys()).toEqual([]);
    });

    it('does not bring back a workout deleted since its edit was left behind', async () => {
      const workout = await storage.createWorkout('Push Day');
      const seq = await storedSeq(workout.id);
      await storage.deleteWorkout(workout.id);
      leaveCopyFromClosedTab({ ...workout, steps: [squat] }, seq);

      await store().loadLibrary();

      expect(store().summaries).toEqual([]);
      expect(unsavedKeys()).toEqual([]);
    });

    it('drops a left-behind copy that can never be restored, and says so', async () => {
      await storage.createWorkout('Push Day');
      leaveCopyFromClosedTab({ not: 'a workout' }, 1);

      await store().loadLibrary();

      expect(store().error).toMatch(/could not be restored/);
      expect(store().status).toBe('ready');
      expect(unsavedKeys()).toEqual([]);
    });

    it('keeps a copy written by a newer build for a build that understands it', async () => {
      const workout = await storage.createWorkout('Push Day');
      leaveCopyFromClosedTab(
        { ...workout, schemaVersion: SCHEMA_VERSION + 1 },
        await storedSeq(workout.id),
      );

      await store().loadLibrary();

      // Valid, just not here: throwing it away would destroy the only copy.
      expect(store().error).toMatch(/newer version/);
      expect(unsavedKeys()).toHaveLength(1);
    });

    it('keeps a left-behind copy whose write failed, for the next load', async () => {
      const workout = await storage.createWorkout('Push Day');
      leaveCopyFromClosedTab({ ...workout, steps: [squat] }, await storedSeq(workout.id));
      const put = vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));
      try {
        await store().loadLibrary();
        expect(store().error).toMatch(/could not be restored.*disk full/);
        expect(unsavedKeys()).toHaveLength(1);
      } finally {
        put.mockRestore();
      }

      await store().loadLibrary();
      expect((await storage.getWorkout(workout.id))?.steps).toEqual([squat]);
      expect(unsavedKeys()).toEqual([]);
    });

    it('stops restoring copies once the database itself fails', async () => {
      const first = await storage.createWorkout('One');
      const second = await storage.createWorkout('Two');
      leaveCopyFromClosedTab({ ...first, steps: [squat] }, await storedSeq(first.id));
      leaveCopyFromClosedTab({ ...second, steps: [squat] }, await storedSeq(second.id));
      const read = vi.spyOn(storage, 'getStoredWorkout').mockRejectedValue(new Error('db blocked'));
      try {
        await store().loadLibrary();

        // One failure, not one per copy, each waiting out its own timeout.
        expect(read).toHaveBeenCalledTimes(1);
        expect(unsavedKeys()).toHaveLength(2);
      } finally {
        read.mockRestore();
      }
    });

    it('does not bring back a workout deleted in another tab while it is open here', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      // Another tab deletes it; nothing tells this one.
      await storage.deleteWorkout(id);

      addStep();
      await store().flushSteps();

      expect(await storage.getWorkout(id)).toBeUndefined();
      expect(store().currentWorkout).toBeNull();
      expect(store().error).toMatch(/no longer in your library/);
      expect(unsavedKeys()).toEqual([]);
    });

    it('refuses to export or duplicate a workout whose latest edits are unsaved', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      const put = vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));
      try {
        addStep();
        await store().flushSteps();

        await store().duplicateWorkout(id);
        expect(store().error).toMatch(/have not been saved/);
        expect(store().summaries).toHaveLength(1);

        await store().exportWorkout(id);
        expect(store().error).toMatch(/have not been saved/);
      } finally {
        put.mockRestore();
      }
    });

    it('puts back the saved version when a discard beats a write it cannot stop', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;
      addStep();
      await store().flushSteps();

      // A write that is already under way when the user discards.
      const realPut = storage.putWorkout;
      const put = vi.spyOn(storage, 'putWorkout').mockImplementationOnce(async (workout) => {
        const record = await realPut(workout);
        store().discardChanges();
        return record;
      });
      try {
        addStep();
        await store().flushSteps();
      } finally {
        put.mockRestore();
      }

      expect(store().currentWorkout).toBeNull();
      expect((await storage.getWorkout(id))?.steps).toHaveLength(1);
      expect(store().summaries[0]?.stepCount).toBe(1);
    });

    it('keeps an edit made while a rename is writing, and the new name', async () => {
      await store().createWorkout('Push Day');
      const id = store().currentWorkout!.id;

      const renaming = store().renameWorkout(id, 'Pull Day');
      addStep();
      await renaming;

      expect(store().currentWorkout).toMatchObject({ name: 'Pull Day', steps: [squat] });
      await store().flushSteps();
      expect(await storage.getWorkout(id)).toMatchObject({ name: 'Pull Day', steps: [squat] });
    });

    it('ignores an edit that changes nothing, and one with nothing open', async () => {
      const put = vi.spyOn(storage, 'putWorkout');
      try {
        // Nothing open: no crash, no write.
        store().editSteps((steps) => [...steps, squat]);
        expect(put).not.toHaveBeenCalled();

        await store().createWorkout('Push Day');
        put.mockClear();
        // A step operation hands back the same array when it declines an edit.
        store().editSteps((steps) => steps);
        await store().flushSteps();
        expect(put).not.toHaveBeenCalled();
      } finally {
        put.mockRestore();
      }
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
    await store().closeWorkout();

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

  it('keeps an unread error across a library reload', async () => {
    await store().createWorkout('Push Day');
    await store().renameWorkout(store().summaries[0]?.id ?? '', '   ');
    expect(store().error).toBe('A workout needs a name.');

    // Returning to the library remounts it, which reloads. The message must
    // survive: the user has not acted on it yet.
    await store().loadLibrary();
    expect(store().error).toBe('A workout needs a name.');
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
