/**
 * A synchronous safety copy of an edit that has not reached IndexedDB yet.
 *
 * Closing the tab hides the page, and that is the last chance to save. An
 * IndexedDB write cannot finish in time: it is several async round trips, and
 * the page is torn down before their callbacks run. `localStorage` writes
 * before the event handler returns, so the edit is stashed there and written
 * properly the next time the app loads.
 *
 * Every access is guarded: storage can be disabled or full, and a stash that
 * cannot be written is no worse than not having one.
 */

const KEY = 'workout-editor:unsaved-workout';

export function stashUnsaved(workout: unknown): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(workout));
  } catch {
    // Nothing better to do while the page is going away.
  }
}

/** The stashed payload, unvalidated: it goes through the same checks as any other write. */
export function readUnsaved(): unknown {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function clearUnsaved(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // A stash left behind is restored once more, which rewrites what is already there.
  }
}
