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
    /** `by-updatedAt` exists only on databases created by v1; see `upgrade`. */
    indexes: { [UPDATED_AT_INDEX]: number; [SEQ_INDEX]: number };
  };
}

let dbPromise: Promise<IDBPDatabase<WorkoutEditorDB>> | undefined;

/**
 * How long to wait for `openDB` before giving up. IndexedDB's `blocked` event
 * does not reject the open request, it stalls it forever, so without a deadline
 * a tab held open on an older DB_VERSION leaves the UI on "Loading your
 * library…" with nothing to click and no error to show.
 */
export const OPEN_TIMEOUT_MS = 10_000;

export function getDb(): Promise<IDBPDatabase<WorkoutEditorDB>> {
  if (dbPromise) return dbPromise;

  /**
   * Drop the cached connection, but only while it is still ours: a callback
   * from a superseded attempt must not evict the handle that replaced it, or
   * that connection becomes unreachable and stays open forever.
   */
  const invalidate = (): void => {
    if (dbPromise === mine) dbPromise = undefined;
  };

  let blockedByOtherTab = false;
  const opening = openDB<WorkoutEditorDB>(DB_NAME, DB_VERSION, {
    async upgrade(db, _oldVersion, _newVersion, tx) {
      // Only create what is missing: on a future DB_VERSION bump this callback
      // runs again against a database that already has the store.
      if (!db.objectStoreNames.contains(WORKOUT_STORE)) {
        const store = db.createObjectStore(WORKOUT_STORE, { keyPath: 'id' });
        // Only `by-seq`: nothing queries `by-updatedAt`, and an index that is
        // maintained on every write but never opened is pure cost. It survives
        // below only because v1 databases already have it and the backfill
        // reads it to recover their order.
        store.createIndex(SEQ_INDEX, 'seq');
        return;
      }

      const store = tx.objectStore(WORKOUT_STORE);
      if (!store.indexNames.contains(SEQ_INDEX)) {
        store.createIndex(SEQ_INDEX, 'seq');
        // A record with no `seq` is absent from the index that now orders the
        // library, which would hide it completely. Stamp the v1 rows in the
        // order they already had.
        // Ordered by the v1 index where it exists; a store without it still
        // gets stamped, just in key order, rather than failing the upgrade.
        const source = store.indexNames.contains(UPDATED_AT_INDEX)
          ? store.index(UPDATED_AT_INDEX)
          : store;
        let seq = 0;
        for (let cursor = await source.openCursor(); cursor; cursor = await cursor.continue()) {
          await cursor.update({ ...cursor.value, seq: ++seq });
        }
      }
    },

    // Another tab is upgrading and is stuck behind this connection. Let go, or
    // both tabs wait on each other forever. Close our own handle rather than
    // whatever is cached now, which may already be a different connection.
    blocking() {
      invalidate();
      void opening.then(
        (db) => db.close(),
        () => undefined,
      );
    },

    // We are the ones stuck, behind a tab holding an older version open. This
    // fires instead of settling, so it only records why the deadline below is
    // about to be hit.
    blocked() {
      blockedByOtherTab = true;
    },

    // This connection died on its own (storage eviction, the browser reclaiming
    // the database). Without this the cached promise keeps resolving to a dead
    // handle and every later call throws until the page is reloaded.
    terminated: invalidate,
  });

  const mine = withTimeout(opening, () => blockedByOtherTab).catch((error: unknown) => {
    // A rejected promise must not be cached, or a single failed open (storage
    // blocked, a stuck upgrade) would break every later call until a reload.
    invalidate();
    throw error;
  });
  dbPromise = mine;
  return mine;
}

/** Turns a stalled open into a rejection the UI can show and retry. */
function withTimeout(
  opening: Promise<IDBPDatabase<WorkoutEditorDB>>,
  wasBlocked: () => boolean,
): Promise<IDBPDatabase<WorkoutEditorDB>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          wasBlocked()
            ? 'Another tab is running an older version of Workout Editor. Close it, then try again.'
            : 'Your browser did not respond when opening the workout library.',
        ),
      );
    }, OPEN_TIMEOUT_MS);
    opening.then(resolve, reject).finally(() => clearTimeout(timer));
  });
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
