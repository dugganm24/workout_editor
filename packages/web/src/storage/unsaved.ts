import type { Workout } from '@workout-editor/core';

/**
 * A safety copy of an edit that has not reached IndexedDB yet: one per
 * workout, in `localStorage`.
 *
 * An autosave is several async IndexedDB round trips, and a tab closed during
 * the pause before it, or during the write itself, is torn down before they
 * finish. `localStorage` writes synchronously, so every edit is copied there as
 * it is made and removed once it has been written. Whatever is left belongs to
 * a tab that closed first, and the next library load writes it.
 *
 * `baseSeq` is the write order (see `WorkoutRecord.seq`) of the stored record
 * the edit was made against. A copy is only written back while the stored
 * record is still that one, so no clocks are compared and nobody else's write
 * is overwritten.
 *
 * Every access is guarded: storage can be disabled or full, and a copy that
 * cannot be written is no worse than not having one.
 */

const PREFIX = 'workout-editor:unsaved:';

export interface UnsavedCopy {
  /** The `localStorage` key, which is what removes it. */
  key: string;
  /** The workout it holds an edit of. */
  id: string;
  baseSeq: number;
  version: number;
  /** Unvalidated: it goes through the same checks as any other write. */
  workout: unknown;
}

let lastVersion = 0;

function keyFor(id: string): string {
  return PREFIX + id;
}

function read(key: string): UnsavedCopy | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    const value = JSON.parse(raw) as Partial<UnsavedCopy>;
    if (typeof value.baseSeq !== 'number' || typeof value.version !== 'number') return undefined;
    return {
      key,
      id: key.slice(PREFIX.length),
      baseSeq: value.baseSeq,
      version: value.version,
      workout: value.workout,
    };
  } catch {
    // Unreadable, or shaped by a build that writes these differently. Left
    // where it is rather than thrown away: it may be someone's only copy.
    return undefined;
  }
}

/**
 * Copies the edit, and returns the version that `clearUnsaved` needs once it
 * has been written. Returns undefined if the copy could not be written, and
 * removes any older one: a copy that is not the current edit is worse than none.
 */
export function stashUnsaved(workout: Workout, baseSeq: number): number | undefined {
  const version = ++lastVersion;
  try {
    localStorage.setItem(keyFor(workout.id), JSON.stringify({ baseSeq, version, workout }));
    return version;
  } catch {
    clearUnsaved(workout.id);
    return undefined;
  }
}

/**
 * Removes a workout's copy. With a `version`, only if the copy is still that
 * version: an edit made while the previous one was being written keeps its own
 * copy until that is written too.
 */
export function clearUnsaved(id: string, version?: number): void {
  const key = keyFor(id);
  try {
    if (version !== undefined && read(key)?.version !== version) return;
    localStorage.removeItem(key);
  } catch {
    // A copy left behind is read again next time, and turns out to be what is stored.
  }
}

/**
 * Takes the copy, so two tabs loading at the same moment cannot both restore
 * it. Returns what was removed, to be put back if the write then fails.
 */
export function claimUnsaved(copy: UnsavedCopy): string | undefined {
  try {
    const raw = localStorage.getItem(copy.key);
    if (read(copy.key)?.version !== copy.version) return undefined;
    localStorage.removeItem(copy.key);
    return raw ?? undefined;
  } catch {
    return undefined;
  }
}

export function returnUnsaved(copy: UnsavedCopy, raw: string): void {
  try {
    localStorage.setItem(copy.key, raw);
  } catch {
    // Nowhere to put it back; the write that failed is reported anyway.
  }
}

export function discardCopy(copy: UnsavedCopy): void {
  try {
    localStorage.removeItem(copy.key);
  } catch {
    // As above.
  }
}

/** Every copy currently held, this tab's own included. */
export function unsavedCopies(): UnsavedCopy[] {
  const copies: UnsavedCopy[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(PREFIX)) continue;
      const copy = read(key);
      if (copy) copies.push(copy);
    }
  } catch {
    // Storage unavailable: there are no copies to find.
  }
  return copies;
}

/** For tests: forgets every copy. */
export function clearAllUnsaved(): void {
  for (const copy of unsavedCopies()) discardCopy(copy);
}
