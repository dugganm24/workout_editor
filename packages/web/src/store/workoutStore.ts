import { create } from 'zustand';
import type { Workout, WorkoutStep } from '@workout-editor/core';
import { errorMessage } from '../errors.ts';
import { downloadLibraryJson, downloadWorkoutJson, parseWorkoutsFile } from '../storage/files.ts';
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

  loadLibrary: () => Promise<void>;
  createWorkout: (name?: string) => Promise<void>;
  openWorkout: (id: string) => Promise<void>;
  closeWorkout: () => void;
  renameWorkout: (id: string, name: string) => Promise<void>;
  duplicateWorkout: (id: string) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  /** Takes a reader rather than text so a failed read reports like any other import error. */
  /**
   * Applies a step-tree edit and saves it in the background. Synchronous on
   * purpose: the editor renders from `currentWorkout`, so a keystroke has to
   * land in state now, not a round trip later.
   */
  editSteps: (edit: (steps: WorkoutStep[]) => WorkoutStep[]) => void;
  /** Writes a pending autosave immediately. Resolves once it has been written. */
  flushSteps: () => Promise<void>;
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
  function run(action: () => Promise<void>, options?: { refresh: boolean }): Promise<void> {
    // Ahead of this action in the same queue, so it writes first.
    void flushSave();
    set({ error: null });
    return serialize(async () => {
      try {
        await action();
        if (options?.refresh !== false) await refresh();
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    });
  }

  /** Reads without writing, so there is nothing to refresh afterwards. */
  const readOnly = { refresh: false } as const;

  /**
   * How long editing pauses before the workout is written: long enough that
   * typing a weight is one write rather than three. Closing the tab inside the
   * pause is covered by the flush when the page is hidden, below.
   */
  const AUTOSAVE_MS = 400;

  let pendingSave: Workout | undefined;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function scheduleSave(workout: Workout): void {
    pendingSave = workout;
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
      // Taken when the write runs, not when it was queued: an action ahead of
      // it in the queue (a rename) may have updated the pending copy since.
      const workout = pendingSave;
      pendingSave = undefined;
      if (!workout) return;
      try {
        await storage.putWorkout(workout);
        await refresh();
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    });
  }

  // Closing the tab or the extension page hides it first. The write is started
  // there rather than left on a timer that will never fire.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushSave();
    });
  }

  return {
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'loading',
    error: null,

    loadLibrary: async () => {
      // `error` is deliberately left alone: this runs on every mount, and
      // returning to the library from the preview must not wipe a message the
      // user has not acted on. "Try again" clears it explicitly.
      set({ status: 'loading' });
      return serialize(async () => {
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
        set({ currentWorkout: workout });
      }),

    openWorkout: async (id) =>
      run(async () => {
        const workout = await storage.getWorkout(id);
        if (!workout) throw new WorkoutNotFoundError();
        set({ currentWorkout: workout });
      }, readOnly),

    closeWorkout: () => {
      // The write already holds its own copy of the workout, so dropping the
      // open one here cannot strand it.
      void flushSave();
      set({ currentWorkout: null });
    },

    editSteps: (edit) => {
      const current = get().currentWorkout;
      if (!current) return;
      const steps = edit(current.steps);
      // Reference equality: every step operation returns the tree it was given
      // when the edit was a no-op, which must not count as a change to save.
      if (steps === current.steps) return;
      const next = { ...current, steps };
      set({ currentWorkout: next, error: null });
      scheduleSave(next);
    },

    flushSteps: () => flushSave(),

    renameWorkout: async (id, name) =>
      run(async () => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('A workout needs a name.');
        const workout = await storage.getWorkout(id);
        if (!workout) throw new WorkoutNotFoundError();
        // A no-op rename must not bump the write order, which would reorder the library.
        if (trimmed !== workout.name) {
          const renamed = { ...workout, name: trimmed };
          await storage.putWorkout(renamed);
          // Steps edited while this was writing are newer than the stored copy,
          // so only the name is carried over, onto the open workout and onto
          // its pending save; that save would otherwise write the old name back.
          const current = get().currentWorkout;
          if (current?.id === id) set({ currentWorkout: { ...current, name: trimmed } });
          if (pendingSave?.id === id) pendingSave = { ...pendingSave, name: trimmed };
        }
      }),

    duplicateWorkout: async (id) =>
      run(async () => {
        await storage.duplicateWorkout(id);
      }),

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
      }, readOnly),

    exportLibrary: async () =>
      run(async () => {
        const { workouts, unreadable } = await storage.readAllForBackup();
        if (workouts.length === 0 && unreadable.length === 0) {
          throw new Error('There are no workouts to export.');
        }
        downloadLibraryJson(workouts, unreadable);
      }, readOnly),

    clearError: () => set({ error: null }),
  };
});
