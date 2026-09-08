import { describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import { closeDb, DB_NAME, getDb, OPEN_TIMEOUT_MS, UPDATED_AT_INDEX, WORKOUT_STORE } from './db.ts';

describe('database connection', () => {
  it('gives up instead of hanging when another tab holds an older version open', async () => {
    // Only setTimeout is faked; fake-indexeddb needs the rest of the clock.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    // A tab still on v1 that never closes: IndexedDB fires `blocked` and then
    // simply never settles the open request.
    const stale = await openDB(DB_NAME, 1, {
      upgrade(db) {
        const store = db.createObjectStore(WORKOUT_STORE, { keyPath: 'id' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      },
    });

    try {
      // Assert before advancing: the rejection lands while the timers run, and
      // a handler attached afterwards would be too late.
      // What matters is that it settles at all: a blocked open neither resolves
      // nor rejects on its own, which used to strand the UI on "Loading your
      // library…" with no error and nothing to retry. (fake-indexeddb does not
      // deliver `blocked`, so the generic message is the one that surfaces.)
      const settled = expect(getDb()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);
      await settled;
    } finally {
      stale.close();
      vi.useRealTimers();
      await closeDb();
    }
  });
});
