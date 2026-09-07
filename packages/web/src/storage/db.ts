import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Workout } from '@workout-editor/core';

/**
 * Local-first persistence. Workouts never leave the browser, so IndexedDB is
 * the only store; there is no server to reconcile with.
 *
 * `updatedAt` lives *beside* the canonical workout rather than inside it:
 * `WorkoutSchema` stays the single source of truth for what a workout is, and
 * Zod's unknown-key stripping can never silently eat our metadata.
 */
export interface WorkoutRecord {
  id: string;
  updatedAt: number;
  /** Stored unvalidated; every read runs it through `migrateWorkout`. */
  workout: Workout;
}

export const DB_NAME = 'workout-editor';
export const DB_VERSION = 1;
export const WORKOUT_STORE = 'workouts';
export const UPDATED_AT_INDEX = 'by-updatedAt';

interface WorkoutEditorDB extends DBSchema {
  [WORKOUT_STORE]: {
    key: string;
    value: WorkoutRecord;
    indexes: { [UPDATED_AT_INDEX]: number };
  };
}

let dbPromise: Promise<IDBPDatabase<WorkoutEditorDB>> | undefined;

export function getDb(): Promise<IDBPDatabase<WorkoutEditorDB>> {
  dbPromise ??= openDB<WorkoutEditorDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(WORKOUT_STORE, { keyPath: 'id' });
      store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
    },
  });
  return dbPromise;
}

/** Drops the cached connection. Tests use this between fresh databases. */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise;
  db.close();
  dbPromise = undefined;
}
