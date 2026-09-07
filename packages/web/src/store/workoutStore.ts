import { create } from 'zustand';
import type { Workout } from '@workout-editor/core';
import { errorMessage } from '../errors.ts';
import { downloadLibraryJson, downloadWorkoutJson, parseWorkoutsFile } from '../storage/files.ts';
import * as storage from '../storage/workouts.ts';
import type { UnreadableWorkout, WorkoutSummary } from '../storage/workouts.ts';

/**
 * Thin wrapper over the storage layer, which stays independently testable.
 *
 * `currentWorkout` doubles as the route: the app shows the library when it is
 * null and the open workout when it is set. A real router is a decision for
 * the builder UI, once there are URLs worth sharing.
 */

export type LibraryStatus = 'idle' | 'loading' | 'ready' | 'error';

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
   * Runs a mutation, refreshes the list, and routes failures to `error`.
   * `status` is deliberately left alone: it describes the library load, and a
   * rejected mutation (a blank name, say) must not make the list look broken.
   */
  async function withRefresh(action: () => Promise<void>): Promise<void> {
    try {
      await action();
      await refresh();
    } catch (error) {
      set({ error: errorMessage(error) });
    }
  }

  return {
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'idle',
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
      withRefresh(async () => {
        const workout = await storage.createWorkout(name);
        set({ currentWorkout: workout, error: null });
      }),

    openWorkout: async (id) => {
      try {
        const workout = await storage.getWorkout(id);
        if (!workout) throw new Error('That workout is no longer in your library.');
        set({ currentWorkout: workout, error: null });
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    closeWorkout: () => set({ currentWorkout: null }),

    renameWorkout: async (id, name) =>
      withRefresh(async () => {
        const trimmed = name.trim();
        if (!trimmed) throw new Error('A workout needs a name.');
        const workout = await storage.getWorkout(id);
        if (!workout) throw new Error('That workout is no longer in your library.');
        // A no-op rename must not bump updatedAt, which would reorder the library.
        if (trimmed !== workout.name) {
          const renamed = { ...workout, name: trimmed };
          await storage.putWorkout(renamed);
          if (get().currentWorkout?.id === id) set({ currentWorkout: renamed });
        }
        set({ error: null });
      }),

    duplicateWorkout: async (id) =>
      withRefresh(async () => {
        await storage.duplicateWorkout(id);
        set({ error: null });
      }),

    deleteWorkout: async (id) =>
      withRefresh(async () => {
        await storage.deleteWorkout(id);
        if (get().currentWorkout?.id === id) set({ currentWorkout: null });
        set({ error: null });
      }),

    importWorkoutFile: async (readFile) =>
      withRefresh(async () => {
        // Reading happens in here so a file that vanishes or turns unreadable
        // between the picker and the read surfaces like every other import
        // failure, instead of rejecting into nothing.
        const text = await readFile().catch((error: unknown) => {
          throw new Error('That file could not be read.', { cause: error });
        });
        // Parse the whole file before writing anything, so a bad entry cannot
        // leave the library half-imported.
        const workouts = parseWorkoutsFile(text);
        for (const workout of workouts) await storage.putWorkout(workout);
        set({ error: null });
      }),

    exportWorkout: async (id) => {
      try {
        const workout = await storage.getWorkout(id);
        if (!workout) throw new Error('That workout is no longer in your library.');
        downloadWorkoutJson(workout);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    exportLibrary: async () => {
      try {
        const workouts = await storage.readAllWorkouts();
        if (workouts.length === 0) throw new Error('There are no workouts to export.');
        downloadLibraryJson(workouts);
      } catch (error) {
        set({ error: errorMessage(error) });
      }
    },

    clearError: () => set({ error: null }),
  };
});
