import { SCHEMA_VERSION, type Workout } from '@workout-editor/core';
import { InvalidWorkoutError, migrateWorkout } from './migrate.ts';
import { copyWorkout } from './workouts.ts';

/**
 * Backup files in the editor's own *canonical* format — not the Garmin Connect
 * JSON the extension consumes. The two must stay clearly labelled in the UI so
 * nobody hands a canonical file to Connect.
 */

const FILE_EXTENSION = '.workout.json';
const LIBRARY_FILE = 'workout-editor-library.json';

/** Envelope for a whole-library backup, so a bundle is distinguishable from one workout. */
const LIBRARY_KIND = 'workout-editor-library';

interface LibraryFile {
  kind: typeof LIBRARY_KIND;
  schemaVersion: number;
  exportedAt: string;
  workouts: unknown[];
  /**
   * Records this build could not parse, kept verbatim. They live under their
   * own key so importing the file is unaffected, but the bytes survive a
   * backup-and-reinstall instead of being silently dropped.
   */
  unreadable?: { id: string; reason: string; raw: unknown }[];
}

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

export function serializeLibrary(
  workouts: Workout[],
  unreadable: { id: string; reason: string; raw: unknown }[] = [],
): string {
  const file: LibraryFile = {
    kind: LIBRARY_KIND,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workouts,
    ...(unreadable.length > 0 ? { unreadable } : {}),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function download(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  // Firefox only downloads from an anchor that is in the document, and revoking
  // the URL in the same tick cancels the download the click just started.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Triggers a browser download of one workout as canonical JSON. */
export function downloadWorkoutJson(workout: Workout): void {
  download(serializeWorkout(workout), workoutFileName(workout));
}

/** Triggers a browser download of the whole library as a single backup file. */
export function downloadLibraryJson(
  workouts: Workout[],
  unreadable: { id: string; reason: string; raw: unknown }[] = [],
): void {
  download(serializeLibrary(workouts, unreadable), LIBRARY_FILE);
}

function isLibraryFile(raw: unknown): raw is { workouts: unknown[]; unreadable?: unknown } {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as { kind?: unknown }).kind === LIBRARY_KIND &&
    Array.isArray((raw as { workouts?: unknown }).workouts)
  );
}

/** What a backup file restores: parsed workouts, plus payloads nothing can parse. */
export interface ParsedBackup {
  workouts: Workout[];
  /** Raw records preserved by a previous export, restored without validation. */
  unreadable: unknown[];
}

function readUnreadable(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).map((entry) =>
    typeof entry === 'object' && entry !== null && 'raw' in entry
      ? (entry as { raw: unknown }).raw
      : entry,
  );
}

/**
 * Parses a canonical backup file, accepting either a single workout or a
 * whole-library bundle. Results get fresh ids, so importing the same file twice
 * yields new workouts instead of silently overwriting existing ones.
 *
 * Records a previous export could not parse come back too, untouched: a backup
 * that refuses to restore the very records it was taken to preserve is not a
 * backup.
 */
export function parseWorkoutsFile(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new InvalidWorkoutError("That file isn't valid JSON.", { cause: error });
  }

  const entries = isLibraryFile(raw) ? raw.workouts : [raw];
  const unreadable = isLibraryFile(raw) ? readUnreadable(raw.unreadable) : [];
  if (entries.length === 0 && unreadable.length === 0) {
    throw new InvalidWorkoutError('That backup file contains no workouts.');
  }

  // Keep each file's name; only the id is fresh.
  const workouts = entries.map((entry) => {
    const workout = migrateWorkout(entry);
    return copyWorkout(workout, workout.name);
  });
  return { workouts, unreadable };
}
