import { SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { getDb, UPDATED_AT_INDEX, WORKOUT_STORE, type WorkoutRecord } from './db.ts';
import { migrateWorkout } from './migrate.ts';

/** What the library list needs, without loading every workout's steps. */
export interface WorkoutSummary {
  id: string;
  name: string;
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
    stepCount: workout.steps.length,
    updatedAt: record.updatedAt,
  };
}

/**
 * Every saved workout, newest first. A record that fails validation is
 * reported in `unreadable` rather than thrown: one corrupt row must not blank
 * out the whole library.
 */
export async function listWorkouts(): Promise<Library> {
  const db = await getDb();
  const records = await db.getAllFromIndex(WORKOUT_STORE, UPDATED_AT_INDEX);

  const workouts: WorkoutSummary[] = [];
  const unreadable: UnreadableWorkout[] = [];
  for (const record of records) {
    try {
      workouts.push(summarize(record, migrateWorkout(record.workout)));
    } catch (error) {
      unreadable.push({
        id: record.id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The index sorts ascending; the library shows most recently touched first.
  workouts.sort((a, b) => b.updatedAt - a.updatedAt);
  return { workouts, unreadable };
}

/** Throws if the stored record is invalid — callers opening a workout need to know. */
export async function getWorkout(id: string): Promise<Workout | undefined> {
  const db = await getDb();
  const record = await db.get(WORKOUT_STORE, id);
  return record ? migrateWorkout(record.workout) : undefined;
}

export async function putWorkout(workout: Workout): Promise<WorkoutRecord> {
  const record: WorkoutRecord = {
    id: workout.id,
    updatedAt: Date.now(),
    workout: migrateWorkout(workout),
  };
  const db = await getDb();
  await db.put(WORKOUT_STORE, record);
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
