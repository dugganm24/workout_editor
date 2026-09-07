import type { Workout } from '@workout-editor/core';
import { InvalidWorkoutError, migrateWorkout } from './migrate.ts';
import { copyWorkout } from './workouts.ts';

/**
 * Backup files in the editor's own *canonical* format — not the Garmin Connect
 * JSON the extension consumes. The two must stay clearly labelled in the UI so
 * nobody hands a canonical file to Connect.
 */

const FILE_EXTENSION = '.workout.json';

export function workoutFileName(workout: Workout): string {
  const slug = workout.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'workout'}${FILE_EXTENSION}`;
}

export function serializeWorkout(workout: Workout): string {
  return `${JSON.stringify(workout, null, 2)}\n`;
}

/** Triggers a browser download of the workout as canonical JSON. */
export function downloadWorkoutJson(workout: Workout): void {
  const blob = new Blob([serializeWorkout(workout)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = workoutFileName(workout);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Parses a canonical backup file. The result gets a fresh id so importing the
 * same file twice yields two workouts instead of silently overwriting one.
 */
export function parseWorkoutFile(text: string): Workout {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidWorkoutError("That file isn't valid JSON.", { cause: error });
  }
  const workout = migrateWorkout(raw);
  // Keep the file's name; only the id is fresh.
  return copyWorkout(workout, workout.name);
}
