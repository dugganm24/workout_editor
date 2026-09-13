import { countLeafSteps, SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { errorMessage } from '../errors.ts';
import { getDb, SEQ_INDEX, WORKOUT_STORE, type WorkoutRecord } from './db.ts';
import { migrateWorkout } from './migrate.ts';

/** What the library list renders for one saved workout. */
export interface WorkoutSummary {
  id: string;
  name: string;
  /** See countLeafSteps: leaf steps, not top-level entries. */
  stepCount: number;
  updatedAt: number;
}

/** A stored record that no longer validates, surfaced instead of thrown. */
export interface UnreadableWorkout {
  id: string;
  reason: string;
  /** The stored payload, kept so a backup can preserve what it cannot parse. */
  raw: unknown;
}

/** The one condition every caller phrases the same way for the user. */
export class WorkoutNotFoundError extends Error {
  constructor() {
    super('That workout is no longer in your library.');
    this.name = 'WorkoutNotFoundError';
  }
}

export interface Library {
  workouts: WorkoutSummary[];
  unreadable: UnreadableWorkout[];
}

function summarize(record: WorkoutRecord, workout: Workout): WorkoutSummary {
  return {
    id: record.id,
    name: workout.name,
    stepCount: countLeafSteps(workout.steps),
    updatedAt: record.updatedAt,
  };
}

interface ReadRecord {
  record: WorkoutRecord;
  workout: Workout;
}

/**
 * One pass over the store in ascending write order: every record is read and
 * validated exactly once. A record that fails validation is reported in
 * `unreadable` rather than thrown — one corrupt row must not blank out the
 * whole library. Callers that show a list reverse it; the ones that write the
 * records back out must not, or the restored order comes back inverted.
 */
async function readAll(): Promise<{ readable: ReadRecord[]; unreadable: UnreadableWorkout[] }> {
  const db = await getDb();
  const records = await db.getAllFromIndex(WORKOUT_STORE, SEQ_INDEX);

  const readable: ReadRecord[] = [];
  const unreadable: UnreadableWorkout[] = [];
  for (const record of records) {
    try {
      readable.push({ record, workout: migrateWorkout(record.workout) });
    } catch (error) {
      unreadable.push({
        id: record.id,
        reason: errorMessage(error),
        raw: record.workout,
      });
    }
  }

  return { readable, unreadable };
}

/** Every saved record, newest first, summarized for the library list. */
export async function listWorkouts(): Promise<Library> {
  const { readable, unreadable } = await readAll();
  return {
    workouts: readable.map(({ record, workout }) => summarize(record, workout)).reverse(),
    // Reversed alongside the workouts: the two lists are shown one above the
    // other, and ordering them opposite ways is a puzzle for the reader.
    unreadable: [...unreadable].reverse(),
  };
}

/**
 * Everything the whole-library backup needs, in write order — oldest first,
 * which is the order `putWorkouts` assigns `seq` in. Handing over the library's
 * newest-first display order instead would restore it upside down, permanently:
 * every restored record shares one `updatedAt`, so `seq` is the only order left.
 *
 * Unreadable records come along as their raw payload: a backup that silently
 * dropped exactly the records the user cannot otherwise reach would be the
 * worst time to lose them.
 */
export async function readAllForBackup(): Promise<{
  workouts: Workout[];
  unreadable: UnreadableWorkout[];
}> {
  const { readable, unreadable } = await readAll();
  return { workouts: readable.map(({ workout }) => workout), unreadable };
}

/** Throws if the stored record is invalid — callers opening a workout need to know. */
export async function getWorkout(id: string): Promise<Workout | undefined> {
  const db = await getDb();
  const record = await db.get(WORKOUT_STORE, id);
  return record ? migrateWorkout(record.workout) : undefined;
}

/**
 * Writes get their `seq` from the store's own highest, inside the same
 * transaction as the write. Ordering therefore survives a reload and stays
 * consistent across tabs — neither of which a module-level counter could
 * manage — and `updatedAt` stays the true wall-clock time rather than being
 * nudged forward to break ties.
 */
export async function putWorkout(workout: Workout): Promise<WorkoutRecord> {
  const [record] = await putWorkouts([workout]);
  if (!record) throw new Error('putWorkouts returned no record');
  return record;
}

/**
 * Writes a batch in a single transaction, so a failure part-way through rolls
 * the whole batch back rather than leaving the library half-written. The max
 * `seq` is read once for the batch instead of once per workout.
 */
export async function putWorkouts(
  workouts: Workout[],
  /**
   * Payloads restored from a backup that this build cannot parse. They are
   * written as-is under a fresh key and will read back as `unreadable`, which
   * is the honest outcome: the bytes are preserved, not silently dropped.
   */
  unreadable: unknown[] = [],
): Promise<WorkoutRecord[]> {
  // Validate before opening the transaction: a throw mid-transaction would
  // leave it to abort on its own.
  const migrated = workouts.map(migrateWorkout);
  if (migrated.length === 0 && unreadable.length === 0) return [];

  const db = await getDb();
  const tx = db.transaction(WORKOUT_STORE, 'readwrite');
  const newest = await tx.store.index(SEQ_INDEX).openCursor(null, 'prev');
  let seq = newest?.value.seq ?? 0;

  const records = [
    // Unreadable payloads take the batch's lowest `seq`. They render no row, so
    // giving them the newest slots would push a restored library's real
    // workouts down the list behind rows nothing can show.
    // The record's own key is fresh; whatever id the payload carries inside is
    // already unparseable, so it is not worth trusting.
    ...unreadable.map((raw) => ({ id: crypto.randomUUID(), workout: raw as Workout })),
    ...migrated.map((workout) => ({ id: workout.id, workout })),
  ].map(({ id, workout }) => ({
    id,
    seq: ++seq,
    updatedAt: Date.now(),
    workout,
  }));
  // Queue every put, then commit once: awaiting each in turn would serialize
  // the round trips for no benefit.
  await Promise.all([...records.map((record) => tx.store.put(record)), tx.done]);
  return records;
}

export async function deleteWorkout(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(WORKOUT_STORE, id);
}

/** A new, empty draft. Steps are added in the editor. */
export function newWorkout(name = 'Untitled workout'): Workout {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    sport: 'strength',
    steps: [],
  };
}

export async function createWorkout(name?: string): Promise<Workout> {
  const workout = newWorkout(name);
  await putWorkout(workout);
  return workout;
}

/** Copies a workout under a fresh id so the original is never overwritten. */
export function copyWorkout(workout: Workout, name = `${workout.name} (copy)`): Workout {
  return { ...structuredClone(workout), id: crypto.randomUUID(), name };
}

export async function duplicateWorkout(id: string): Promise<Workout> {
  const original = await getWorkout(id);
  if (!original) throw new WorkoutNotFoundError();
  const copy = copyWorkout(original);
  await putWorkout(copy);
  return copy;
}
