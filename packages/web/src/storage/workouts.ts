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
 * One pass over the store, newest first: every record is read and validated
 * exactly once. A record that fails validation is reported in `unreadable`
 * rather than thrown — one corrupt row must not blank out the whole library.
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
      });
    }
  }

  // The index sorts by ascending write order; the library shows newest first.
  readable.reverse();
  return { readable, unreadable };
}

/** Every saved workout, newest first, summarized for the library list. */
export async function listWorkouts(): Promise<Library> {
  const { readable, unreadable } = await readAll();
  return {
    workouts: readable.map(({ record, workout }) => summarize(record, workout)),
    unreadable,
  };
}

/** Every readable workout in full, newest first. Backs the whole-library backup. */
export async function readAllWorkouts(): Promise<Workout[]> {
  const { readable } = await readAll();
  return readable.map(({ workout }) => workout);
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
  // Validate before opening the transaction: a throw mid-transaction would
  // leave it to abort on its own.
  const migrated = migrateWorkout(workout);

  const db = await getDb();
  const tx = db.transaction(WORKOUT_STORE, 'readwrite');
  const newest = await tx.store.index(SEQ_INDEX).openCursor(null, 'prev');
  const record: WorkoutRecord = {
    id: workout.id,
    seq: (newest?.value.seq ?? 0) + 1,
    updatedAt: Date.now(),
    workout: migrated,
  };
  await tx.store.put(record);
  await tx.done;
  return record;
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
  if (!original) throw new Error(`No workout with id "${id}"`);
  const copy = copyWorkout(original);
  await putWorkout(copy);
  return copy;
}
