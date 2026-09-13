import { SCHEMA_VERSION, WorkoutSchema, type Workout } from '@workout-editor/core';

/**
 * The forward-migration hook. Breaking model changes bump `SCHEMA_VERSION` and
 * add their upgrade step here, so workouts saved by an older build keep
 * opening. Version 1 is the baseline: nothing to upgrade yet.
 */

/** A workout written by a build newer than this one. */
export class UnsupportedSchemaVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(
      `This workout was saved by a newer version of Workout Editor ` +
        `(schema v${version}, this build understands v${SCHEMA_VERSION}). Reload the page to update.`,
    );
    this.name = 'UnsupportedSchemaVersionError';
    this.version = version;
  }
}

/** Data that does not look like a workout at all. */
export class InvalidWorkoutError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InvalidWorkoutError';
  }
}

function readSchemaVersion(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  return typeof version === 'number' ? version : undefined;
}

/**
 * Validates and, where needed, upgrades stored or imported data to the current
 * canonical `Workout`. Throws `UnsupportedSchemaVersionError` or
 * `InvalidWorkoutError` — both carry a message safe to show the user.
 */
export function migrateWorkout(raw: unknown): Workout {
  const version = readSchemaVersion(raw);
  if (version !== undefined && version > SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version);
  }

  const result = WorkoutSchema.safeParse(raw);
  if (!result.success) {
    const [issue] = result.error.issues;
    const where = issue && issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : '';
    throw new InvalidWorkoutError(
      `Not a valid workout${where}: ${issue?.message ?? 'unknown validation error'}`,
      { cause: result.error },
    );
  }
  return result.data;
}
