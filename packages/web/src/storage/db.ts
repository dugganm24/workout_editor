import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Workout } from '@workout-editor/core';

/**
 * Local-first persistence. Workouts never leave the browser, so IndexedDB is
 * the only store; there is no server to reconcile with.
 *
 * `updatedAt` and `seq` live *beside* the canonical workout rather than inside
 * it: `WorkoutSchema` stays the single source of truth for what a workout is,
 * and Zod's unknown-key stripping can never silently eat our metadata.
 */
export interface WorkoutRecord {
  id: string;
  /**
   * Write order, allocated from the store itself. This — not `updatedAt` —
   * orders the library, so two writes in the same millisecond cannot tie and
   * `updatedAt` is free to be the honest wall-clock time.
   */
  seq: number;
  updatedAt: number;
  /** Stored unvalidated; every read runs it through `migrateWorkout`. */
  workout: Workout;
}

export const DB_NAME = 'workout-editor';
export const DB_VERSION = 2;
export const WORKOUT_STORE = 'workouts';
export const UPDATED_AT_INDEX = 'by-updatedAt';
export const SEQ_INDEX = 'by-seq';

interface WorkoutEditorDB extends DBSchema {
  [WORKOUT_STORE]: {
    key: string;
    value: WorkoutRecord;
    indexes: { [UPDATED_AT_INDEX]: number; [SEQ_INDEX]: number };
  };
}

let dbPromise: Promise<IDBPDatabase<WorkoutEditorDB>> | undefined;

export function getDb(): Promise<IDBPDatabase<WorkoutEditorDB>> {
  dbPromise ??= openDB<WorkoutEditorDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, _oldVersion, _newVersion, tx) {
      // Only create what is missing: on a future DB_VERSION bump this callback
      // runs again against a database that already has the store.
      if (!db.objectStoreNames.contains(WORKOUT_STORE)) {
        const store = db.createObjectStore(WORKOUT_STORE, { keyPath: 'id' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
        store.createIndex(SEQ_INDEX, 'seq');
        return;
      }

      const store = tx.objectStore(WORKOUT_STORE);
      if (!store.indexNames.contains(SEQ_INDEX)) {
        store.createIndex(SEQ_INDEX, 'seq');
        // A record with no `seq` is absent from the index that now orders the
        // library, which would hide it completely. Stamp the v1 rows in the
        // order they already had.
        let seq = 0;
        for (
          let cursor = await store.index(UPDATED_AT_INDEX).openCursor();
          cursor;
          cursor = await cursor.continue()
        ) {
          await cursor.update({ ...cursor.value, seq: ++seq });
        }
      }
    },

    // Another tab is upgrading and is stuck behind this connection. Let go, or
    // both tabs wait on each other forever.
    blocking() {
      void closeDb();
    },

    // This connection died on its own (storage eviction, the browser reclaiming
    // the database). Without this the cached promise keeps resolving to a dead
    // handle and every later call throws until the page is reloaded.
    terminated() {
      dbPromise = undefined;
    },
  }).catch((error: unknown) => {
    // A rejected promise must not be cached, or a single failed open (storage
    // blocked, a stuck upgrade) would break every later call until a reload.
    dbPromise = undefined;
    throw error;
  });
  return dbPromise;
}

/** Drops the cached connection. Tests use this between fresh databases. */
export async function closeDb(): Promise<void> {
  const pending = dbPromise;
  if (!pending) return;
  dbPromise = undefined;
  try {
    (await pending).close();
  } catch {
    // Never opened; there is nothing to close.
  }
}
