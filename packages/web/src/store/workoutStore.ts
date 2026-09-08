import { create } from 'zustand';
import type { Workout } from '@workout-editor/core';
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
   * The one path every action takes: run it, refresh the list unless the action
   * changed nothing, and clear or set `error` from the outcome. Clearing on
   * success lives here rather than in each action because that is how a stale
   * banner kept surviving actions that succeeded.
   *
   * `status` is deliberately left alone: it describes the library load, and a
   * rejected action (a blank name, say) must not make the list look broken.
   */
  async function run(action: () => Promise<void>, options?: { refresh: boolean }): Promise<void> {
    try {
      await action();
      if (options?.refresh !== false) await refresh();
      set({ error: null });
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  }

  /** Reads without writing, so there is nothing to refresh afterwards. */
  const readOnly = { refresh: false } as const;

  return {
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'loading',
    error: null,

    loadLibrary: async () => {
      set({ status: 'loading', error: null });
      try {
        await refresh();
      } catch (error) {
        set({ error: errorMessage(error), status: 'error' });
      }
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

    closeWorkout: () => set({ currentWorkout: null }),

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
          if (get().currentWorkout?.id === id) set({ currentWorkout: renamed });
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
        await storage.putWorkouts(parseWorkoutsFile(text));
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
