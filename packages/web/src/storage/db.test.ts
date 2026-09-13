import { describe, expect, it, vi } from 'vitest';
import { closeDb, getDb, OPEN_TIMEOUT_MS } from './db.ts';

describe('database connection', () => {
  it('gives up instead of hanging when the open request never settles', async () => {
    // Only setTimeout is faked; fake-indexeddb needs the rest of the clock.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    // IndexedDB can leave an open request pending forever rather than failing:
    // a tab holding an older version open fires `blocked` and then simply never
    // settles. Nothing here can produce that state on demand, so stand in for
    // it with a request that fires no events at all.
    // Built on the real prototype so idb recognises it as a request and waits
    // on its events, of which there are none.
    const stalled = Object.assign(Object.create(IDBOpenDBRequest.prototype) as object, {
      addEventListener() {},
      removeEventListener() {},
    });
    const open = vi
      .spyOn(indexedDB, 'open')
      .mockReturnValue(stalled as unknown as IDBOpenDBRequest);

    try {
      // Assert before advancing: the rejection lands while the timers run, and
      // a handler attached afterwards would be too late.
      // What matters is that it settles at all — an open that neither resolves
      // nor rejects used to strand the UI on "Loading your library…" with no
      // error and nothing to retry.
      const settled = expect(getDb()).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS);
      await settled;
    } finally {
      open.mockRestore();
      vi.useRealTimers();
      await closeDb();
    }
  });
});
