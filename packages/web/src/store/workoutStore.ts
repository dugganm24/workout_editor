import { create } from 'zustand';
import type { Workout, WorkoutStep } from '@workout-editor/core';
import { errorMessage } from '../errors.ts';
import { downloadLibraryJson, downloadWorkoutJson, parseWorkoutsFile } from '../storage/files.ts';
import type { WorkoutRecord } from '../storage/db.ts';
import { migrateWorkout, UnsupportedSchemaVersionError } from '../storage/migrate.ts';
import {
  claimUnsaved,
  clearUnsaved,
  discardCopy,
  returnUnsaved,
  stashUnsaved,
  unsavedCopies,
  type UnsavedCopy,
} from '../storage/unsaved.ts';
import * as storage from '../storage/workouts.ts';
import { WorkoutNotFoundError } from '../storage/workouts.ts';
import type { UnreadableWorkout, WorkoutSummary } from '../storage/workouts.ts';

/**
 * Thin wrapper over the storage layer, which stays independently testable.
 *
 * `currentWorkout` doubles as the route: the app shows the library when it is
 * null and the open workout when it is set. A real router is a decision for
 * the builder UI, once there are URLs worth sharing.
 */

export type LibraryStatus = 'loading' | 'ready' | 'error';

export interface WorkoutState {
  summaries: WorkoutSummary[];
  unreadable: UnreadableWorkout[];
  currentWorkout: Workout | null;
  status: LibraryStatus;
  error: string | null;
  /**
   * Why the open workout's latest edits could not be written, while they
   * still have not been. Kept apart from `error` because it is not a one-off:
   * it stands until a retry succeeds or the edits are discarded, and an edit
   * made meanwhile must not dismiss it.
   */
  saveError: string | null;

  loadLibrary: () => Promise<void>;
  createWorkout: (name?: string) => Promise<void>;
  openWorkout: (id: string) => Promise<void>;
  /** Writes pending edits first, and stays open if they could not be written. */
  closeWorkout: () => Promise<void>;
  /** Drops edits that could not be saved, and closes the workout. */
  discardChanges: () => void;
  renameWorkout: (id: string, name: string) => Promise<void>;
  duplicateWorkout: (id: string) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  /**
   * Applies a step-tree edit and saves it in the background. Synchronous on
   * purpose: the editor renders from `currentWorkout`, so a keystroke has to
   * land in state now, not a round trip later.
   */
  editSteps: (edit: (steps: WorkoutStep[]) => WorkoutStep[]) => void;
  /** Writes a pending autosave immediately. Resolves once it has been written. */
  flushSteps: () => Promise<void>;
  /** Takes a reader rather than text so a failed read reports like any other import error. */
  importWorkoutFile: (readFile: () => Promise<string>) => Promise<void>;
  exportWorkout: (id: string) => Promise<void>;
  exportLibrary: () => Promise<void>;
  clearError: () => void;
}

export const useWorkoutStore = create<WorkoutState>((set, get) => {
  /** Re-reads the library so the list never drifts from the database. */
  async function refresh(): Promise<void> {
    const { workouts, unreadable } = await storage.listWorkouts();
    set({ summaries: workouts, unreadable, status: 'ready' });
  }

  /**
   * Actions run one at a time, in dispatch order. Storage is async, so
   * overlapping actions each read the database before the other has written:
   * blurring a rename and clicking Export in the same gesture dispatches both
   * at once, and the export used to read the pre-rename record.
   */
  let queue: Promise<void> = Promise.resolve();
  function serialize(work: () => Promise<void>): Promise<void> {
    const result = queue.then(work);
    // One action's failure must not break the chain for the next.
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * The one path every action takes: run it, refresh the list unless the action
   * changed nothing, and route a failure to `error`.
   *
   * The banner is cleared at *dispatch*, not on success. Clearing on success
   * meant a later action finishing could wipe an error the user had not read
   * yet; clearing up front dismisses the old banner when the user asks for
   * something new, and leaves whatever this batch of work reports.
   *
   * `status` is deliberately left alone: it describes the library load, and a
   * rejected action (a blank name, say) must not make the list look broken.
   */
  function run(
    action: () => Promise<void>,
    options?: { refresh?: boolean; needsSavedWorkout?: boolean },
  ): Promise<void> {
    // Ahead of this action in the same queue, so it writes first.
    const writing = flushSave();
    set({ error: null });
    return serialize(async () => {
      try {
        await writing;
        // Reading the workout back out of storage while its latest edits could
        // not be written would quietly leave them out of the copy or the file.
        if (options?.needsSavedWorkout && get().saveError !== null) {
          throw new Error(
            'Your latest changes have not been saved yet, so this would leave them out. Try again, or discard them.',
          );
        }
        await action();
        if (options?.refresh !== false) await refresh();
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    });
  }

  /** Reads without writing, so there is nothing to refresh afterwards. */
  const readOnly = { refresh: false } as const;
  /** Reads the workout back out of storage, so what is on screen has to be in there. */
  const savedReadOnly = { refresh: false, needsSavedWorkout: true } as const;

  /**
   * How long editing pauses before the workout is written: long enough that
   * typing a weight is one write rather than three. A tab closed before the
   * write finishes leaves a safety copy behind (see `storage/unsaved.ts`).
   */
  const AUTOSAVE_MS = 400;

  interface PendingSave {
    workout: Workout;
    /** Of its safety copy, which is removed only once this version is written. Absent if it could not be copied. */
    version: string | undefined;
  }

  let pendingSave: PendingSave | undefined;
  /** Read through a call: an edit made during an await is invisible to narrowing. */
  const pendingNow = (): PendingSave | undefined => pendingSave;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  /** The open workout as last written, and the write order that write took. */
  let lastSaved: Workout | undefined;
  let lastSavedSeq = 0;
  /** Bumped by a discard, so a write already under way cannot keep what was discarded. */
  let discards = 0;

  /** Puts a workout on screen with no unsaved edits behind it. */
  function openInEditor(workout: Workout, seq: number): void {
    lastSaved = workout;
    lastSavedSeq = seq;
    set({ currentWorkout: workout, saveError: null });
  }

  /**
   * The one way the open workout changes: on screen now, copied to the safety
   * store now, written after the pause.
   */
  function updateCurrent(workout: Workout): void {
    set({ currentWorkout: workout });
    pendingSave = { workout, version: stashUnsaved(workout, lastSavedSeq) };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void flushSave(), AUTOSAVE_MS);
  }

  /**
   * Queues the pending write like any other action, so it cannot interleave
   * with one. Every dispatch flushes first (see `run`): an action that reads
   * this workout back out of storage — duplicate, export, the library's own
   * list — must not see the state from before the last keystroke.
   */
  function flushSave(): Promise<void> {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    // Nothing waiting on a timer, but a write the timer already started may
    // still be in the queue. Wait for the queue itself, so callers can treat
    // this as "everything I typed is on disk".
    if (!pendingSave) return queue;
    return serialize(async () => {
      // Nothing in here may reject: "← Back to library" and "Try again" wait on
      // it, and a rejection would leave them doing nothing at all, silently.
      try {
        await write();
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    });
  }

  async function write(): Promise<void> {
    // Taken when the write runs, not when it was queued, so it is always the
    // newest edit.
    const save = pendingSave;
    pendingSave = undefined;
    if (!save) return;
    const discardsAtStart = discards;
    const previous = lastSaved;

    let record: WorkoutRecord;
    try {
      // Deleted in another tab: writing would bring it back, undoing a delete
      // the user meant. Two tabs *editing* one workout is still last writer
      // wins — refusing to save what is on screen would be worse.
      if (!(await storage.getStoredWorkout(save.workout.id))) {
        throw new WorkoutNotFoundError();
      }
      record = await storage.putWorkout(save.workout);
    } catch (error) {
      if (discardsAtStart !== discards) return;
      if (error instanceof WorkoutNotFoundError) {
        clearUnsaved(save.workout.id);
        set({ currentWorkout: null, saveError: null, error: errorMessage(error) });
        await refresh();
        return;
      }
      // Put back unless something newer was typed meanwhile (that copy has
      // this edit in it too), so the next edit, close or "Try again" retries
      // the write instead of the edit existing nowhere but on screen.
      pendingSave ??= save;
      set({ saveError: errorMessage(error) });
      return;
    }

    // Only the copy this write holds. Without a version there is no copy of
    // this edit — its own stash failed — and the one in storage belongs to a
    // later edit that still needs it.
    if (save.version !== undefined) clearUnsaved(save.workout.id, save.version);
    if (discardsAtStart !== discards) {
      // Discarded while this was writing. The write cannot be called back, so
      // put the version it replaced back in its place.
      if (previous) await storage.putWorkout(previous).catch(() => undefined);
      await refresh();
      return;
    }

    lastSaved = save.workout;
    lastSavedSeq = record.seq;
    // An edit typed while this was writing was copied against the record this
    // write has just replaced. Copy it again against the new one, or the next
    // load would read it as older than what is stored and drop it — in the very
    // window ("the tab closed mid-write") the copies exist for.
    const newer = pendingNow();
    if (newer) {
      pendingSave = { workout: newer.workout, version: stashUnsaved(newer.workout, lastSavedSeq) };
    }
    if (get().saveError !== null) set({ saveError: null });
    // Only this workout's summary changed. Re-reading and re-validating the
    // whole library on every pause in typing held up the queue for nothing;
    // the list reloads in full when the library is shown again.
    const summary = storage.summarize(record, save.workout);
    set((state) => ({
      summaries: [summary, ...state.summaries.filter((s) => s.id !== summary.id)],
    }));
  }

  // A page that is only being switched away from has all the time it needs,
  // so start the write now rather than leave it to a timer. A page that is
  // closing may not finish it; its safety copy covers that.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushSave();
    });
  }

  /**
   * Writes back one copy a closed tab left behind, if the workout it was edited
   * from is still the one stored. Returns what to tell the user, if anything.
   *
   * Storage failures are thrown, since the next copy would only fail the same
   * way; anything wrong with the copy itself is returned, so the copies after
   * it still get their turn.
   */
  async function restoreCopy(copy: UnsavedCopy): Promise<string | undefined> {
    const failed = (error: unknown) =>
      `Unsaved changes from a closed tab could not be restored. ${errorMessage(error)}`;

    let workout: Workout;
    try {
      workout = migrateWorkout(copy.workout);
    } catch (error) {
      // A copy written by a newer build is valid, just not here: a build that
      // understands it can still write it. Anything else never will be.
      if (!(error instanceof UnsupportedSchemaVersionError)) discardCopy(copy);
      return failed(error);
    }

    const stored = await storage.getStoredWorkout(workout.id);
    // Deleted since; or written since, which this copy did not start from, so
    // writing it would undo that.
    if (!stored) {
      discardCopy(copy);
      return undefined;
    }
    if (stored.seq !== copy.baseSeq) {
      discardCopy(copy);
      return 'Unsaved changes from a closed tab were dropped: that workout has been saved since.';
    }

    // Taken before the write, so two tabs loading at once cannot both write it.
    const claimed = claimUnsaved(copy);
    if (claimed === undefined) return undefined;
    try {
      await storage.putWorkout(workout);
    } catch (error) {
      returnUnsaved(copy, claimed);
      throw error;
    }
    return undefined;
  }

  /**
   * Its errors are its own: the library still loads. The first storage failure
   * stops it — with the database unavailable, every further copy would wait out
   * its own timeout before failing the same way.
   */
  async function restoreAbandoned(): Promise<void> {
    const open = get().currentWorkout?.id ?? pendingSave?.workout.id;
    for (const copy of unsavedCopies()) {
      // This tab is still editing it, and its own autosave is responsible.
      if (copy.id === open) continue;
      try {
        const problem = await restoreCopy(copy);
        if (problem) set({ error: problem });
      } catch (error) {
        set({
          error: `Unsaved changes from a closed tab could not be restored. ${errorMessage(error)}`,
        });
        return;
      }
    }
  }

  return {
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'loading',
    error: null,
    saveError: null,

    loadLibrary: async () => {
      // `error` is deliberately left alone: this runs on every mount, and
      // returning to the library from the preview must not wipe a message the
      // user has not acted on. "Try again" clears it explicitly.
      set({ status: 'loading' });
      return serialize(async () => {
        await restoreAbandoned();
        try {
          await refresh();
        } catch (error) {
          set({ error: errorMessage(error), status: 'error' });
        }
      });
    },

    createWorkout: async (name) =>
      run(async () => {
        const workout = await storage.createWorkout(name);
        const stored = await storage.getStoredWorkout(workout.id);
        openInEditor(workout, stored?.seq ?? 0);
      }),

    openWorkout: async (id) =>
      run(async () => {
        const stored = await storage.getStoredWorkout(id);
        if (!stored) throw new WorkoutNotFoundError();
        openInEditor(stored.workout, stored.seq);
      }, readOnly),

    closeWorkout: async () => {
      await flushSave();
      // The edits are on screen and nowhere else, so closing would throw them
      // away. The editor stays open with the save error and its choices:
      // try again, or discard them.
      if (get().saveError !== null) return;
      set({ currentWorkout: null });
    },

    discardChanges: () => {
      const current = get().currentWorkout;
      clearTimeout(saveTimer);
      saveTimer = undefined;
      pendingSave = undefined;
      discards++;
      if (current) clearUnsaved(current.id);
      lastSaved = undefined;
      set({ currentWorkout: null, saveError: null });
    },

    editSteps: (edit) => {
      const current = get().currentWorkout;
      if (!current) return;
      const steps = edit(current.steps);
      // Reference equality: every step operation returns the tree it was given
      // when the edit was a no-op, which must not count as a change to save.
      if (steps === current.steps) return;
      if (get().error !== null) set({ error: null });
      updateCurrent({ ...current, steps });
    },

    flushSteps: () => flushSave(),

    renameWorkout: async (id, name) => {
      const trimmed = name.trim();
      const current = get().currentWorkout;
      // The open workout is renamed like any other edit to it: in memory, then
      // saved with its steps. Writing the stored record instead would make two
      // copies of the truth that every later edit would have to reconcile.
      // A blank name takes the queued path below, so its complaint lands in
      // order with other actions dispatched alongside it.
      if (trimmed && current?.id === id) {
        set({ error: null });
        // A no-op rename must not bump the write order, which would reorder the library.
        if (trimmed !== current.name) updateCurrent({ ...current, name: trimmed });
        return flushSave();
      }
      return run(async () => {
        if (!trimmed) throw new Error('A workout needs a name.');
        const workout = await storage.getWorkout(id);
        if (!workout) throw new WorkoutNotFoundError();
        if (trimmed !== workout.name) await storage.putWorkout({ ...workout, name: trimmed });
      });
    },

    duplicateWorkout: async (id) =>
      run(
        async () => {
          await storage.duplicateWorkout(id);
        },
        { needsSavedWorkout: true },
      ),

    deleteWorkout: async (id) =>
      run(async () => {
        await storage.deleteWorkout(id);
        if (get().currentWorkout?.id === id) set({ currentWorkout: null });
      }),

    importWorkoutFile: async (readFile) =>
      run(async () => {
        // Reading happens in here so a file that vanishes or turns unreadable
        // between the picker and the read surfaces like every other import
        // failure, instead of rejecting into nothing.
        const text = await readFile().catch((error: unknown) => {
          throw new Error('That file could not be read.', { cause: error });
        });
        // Parse the whole file, then write it in one transaction: neither a bad
        // entry nor a failed write can leave the library half-imported.
        const { workouts, unreadable } = parseWorkoutsFile(text);
        await storage.putWorkouts(workouts, unreadable);
      }),

    exportWorkout: async (id) =>
      run(async () => {
        const workout = await storage.getWorkout(id);
        if (!workout) throw new WorkoutNotFoundError();
        downloadWorkoutJson(workout);
      }, savedReadOnly),

    exportLibrary: async () =>
      run(async () => {
        const { workouts, unreadable } = await storage.readAllForBackup();
        if (workouts.length === 0 && unreadable.length === 0) {
          throw new Error('There are no workouts to export.');
        }
        downloadLibraryJson(workouts, unreadable);
      }, savedReadOnly),

    clearError: () => set({ error: null }),
  };
});
