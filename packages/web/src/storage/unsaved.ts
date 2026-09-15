import type { Workout } from '@workout-editor/core';

/**
 * Safety copies of edits that have not reached IndexedDB yet.
 *
 * An autosave is several async IndexedDB round trips, and a tab closed during
 * the pause before it, or during the write itself, is torn down before they
 * finish. `localStorage` writes synchronously, so every edit is copied there
 * as it is made, and the copy is removed once that exact version is saved.
 * Whatever is left belongs to a tab that closed first, and the next library
 * load writes it properly.
 *
 * Copies are keyed by tab as well as workout. Two tabs editing the same workout
 * each keep their own copy, and a save in one never clears the other's.
 *
 * Every access is guarded: storage can be disabled or full, and a copy that
 * cannot be written is no worse than not having one.
 */

const PREFIX = 'workout-editor:unsaved:';
const LOCK_PREFIX = 'workout-editor:tab:';

/** This tab, so its copies can be told apart from those of other tabs. */
const TAB_ID = crypto.randomUUID();

export interface UnsavedCopy {
  /** The `localStorage` key, which is what removes it. */
  key: string;
  tab: string;
  version: number;
  /** When the edit was made. A stored record written later is newer than the copy. */
  editedAt: number;
  /** Unvalidated: it goes through the same checks as any other write. */
  workout: unknown;
}

let lastVersion = 0;
let lockRequested = false;

/**
 * Holds a Web Lock named for this tab for as long as the tab lives. Another tab
 * restoring copies can then see which tabs are still open, and leave their
 * copies to them rather than writing an edit that is still in progress.
 */
function holdTabLock(): void {
  if (lockRequested || typeof navigator === 'undefined' || !navigator.locks) return;
  lockRequested = true;
  void navigator.locks.request(LOCK_PREFIX + TAB_ID, () => new Promise<never>(() => {}));
}

function keyFor(id: string): string {
  return `${PREFIX}${TAB_ID}:${id}`;
}

function parse(key: string, raw: string | null): UnsavedCopy | undefined {
  if (raw === null) return undefined;
  try {
    const value = JSON.parse(raw) as Partial<UnsavedCopy>;
    if (typeof value.tab !== 'string' || typeof value.version !== 'number') return undefined;
    if (typeof value.editedAt !== 'number') return undefined;
    return {
      key,
      tab: value.tab,
      version: value.version,
      editedAt: value.editedAt,
      workout: value.workout,
    };
  } catch {
    return undefined;
  }
}

/** Copies the edit and returns its version, which `clearUnsaved` needs once that edit is saved. */
export function stashUnsaved(workout: Workout): number {
  holdTabLock();
  const version = ++lastVersion;
  try {
    localStorage.setItem(
      keyFor(workout.id),
      JSON.stringify({ tab: TAB_ID, version, editedAt: Date.now(), workout }),
    );
  } catch {
    // Storage full or disabled: the in-memory edit and its autosave carry on.
  }
  return version;
}

/**
 * Removes this tab's copy of a workout. With a `version`, only if the copy is
 * still that version: a newer edit made while the older one was saving keeps
 * its copy until it is saved too.
 */
export function clearUnsaved(id: string, version?: number): void {
  const key = keyFor(id);
  try {
    if (version !== undefined && parse(key, localStorage.getItem(key))?.version !== version) return;
    localStorage.removeItem(key);
  } catch {
    // A copy left behind is restored later, and turns out identical to what is stored.
  }
}

export function discardCopy(copy: UnsavedCopy): void {
  try {
    localStorage.removeItem(copy.key);
  } catch {
    // As above.
  }
}

function allCopies(): UnsavedCopy[] {
  const copies: UnsavedCopy[] = [];
  try {
    // Keys first: removing while walking by index would skip the key after each removal.
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(PREFIX));
    for (const key of keys) {
      const copy = parse(key, localStorage.getItem(key));
      if (copy) copies.push(copy);
      // Unparseable: nothing can be recovered from it.
      else localStorage.removeItem(key);
    }
  } catch {
    // Storage unavailable: there are no copies to find.
  }
  return copies;
}

/**
 * Copies whose tab has closed. This tab's own are never among them: its edits
 * are still in memory, and its autosave is still responsible for them.
 */
export async function abandonedCopies(): Promise<UnsavedCopy[]> {
  const copies = allCopies().filter((copy) => copy.tab !== TAB_ID);
  if (copies.length === 0) return copies;
  const live = new Set<string>();
  try {
    const { held = [] } = await navigator.locks.query();
    for (const lock of held) {
      if (lock.name?.startsWith(LOCK_PREFIX)) live.add(lock.name.slice(LOCK_PREFIX.length));
    }
  } catch {
    // No Web Locks: no way to see other tabs, so every other tab's copy counts
    // as abandoned. Restoring one that is still being edited writes an edit its
    // own tab is about to write anyway.
  }
  return copies.filter((copy) => !live.has(copy.tab));
}

/** For tests: forgets every copy, from every tab. */
export function clearAllUnsaved(): void {
  for (const copy of allCopies()) discardCopy(copy);
}
