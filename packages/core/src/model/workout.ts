import { z } from 'zod';

/**
 * Canonical workout model. This is the editor's own format, Garmin Connect
 * JSON (and any future targets like FIT) are compile targets converted to and
 * from this shape in `src/connect/`.
 *
 * `schemaVersion` gates forward migrations. Any breaking change to these
 * schemas bumps the version and adds a migration so saved/shared workouts
 * never break on upgrade.
 */

export const SCHEMA_VERSION = 1;

/**
 * The rules for each number a user types. Named so the editor's number boxes
 * check a value against the same schema a save will, rather than a hand-kept
 * copy of it that drifts (`Number.isInteger` accepts integers past 2^53,
 * which `.int()` rejects).
 */
export const RepsSchema = z.number().int().positive();
export const SecondsSchema = z.number().positive();
/** Weight in kilograms; display unit conversion happens in the UI. */
export const KilogramsSchema = z.number().positive();
export const RoundsSchema = z.number().int().min(1);

export const WeightTargetSchema = z.object({
  type: z.literal('weight'),
  kg: KilogramsSchema,
});

export const ExerciseStepSchema = z.object({
  kind: z.literal('exercise'),
  /** Exercise category key, e.g. "BENCH_PRESS". Taxonomy lives in src/exercises/. */
  category: z.string().min(1),
  /** Specific exercise key within the category, e.g. "BARBELL_BENCH_PRESS". */
  exercise: z.string().min(1).optional(),
  duration: z.discriminatedUnion('type', [
    z.object({ type: z.literal('reps'), reps: RepsSchema }),
    z.object({ type: z.literal('time'), seconds: SecondsSchema }),
    z.object({ type: z.literal('open') }),
  ]),
  target: WeightTargetSchema.optional(),
  notes: z.string().optional(),
});

export const RestStepSchema = z.object({
  kind: z.literal('rest'),
  duration: z.discriminatedUnion('type', [
    z.object({ type: z.literal('time'), seconds: SecondsSchema }),
    z.object({ type: z.literal('open') }),
  ]),
});

export const RepeatBlockSchema = z.object({
  kind: z.literal('repeat'),
  rounds: RoundsSchema,
  get steps() {
    return z.array(WorkoutStepSchema).min(1);
  },
});

export const WorkoutStepSchema: z.ZodType<WorkoutStep> = z.discriminatedUnion('kind', [
  ExerciseStepSchema,
  RestStepSchema,
  RepeatBlockSchema,
]);

export const WorkoutSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  sport: z.literal('strength'),
  /**
   * May be empty: a freshly created workout has no steps yet, and the JSON
   * backup has to round-trip that draft. "At least one step" is a requirement
   * of conversion to a device format, not of storage — the first converter
   * written needs to enforce it, since nothing here does.
   */
  steps: z.array(WorkoutStepSchema),
});

export type WeightTarget = z.infer<typeof WeightTargetSchema>;
export type ExerciseStep = z.infer<typeof ExerciseStepSchema>;
export type RestStep = z.infer<typeof RestStepSchema>;
export interface RepeatBlock {
  kind: 'repeat';
  rounds: number;
  steps: WorkoutStep[];
}
export type WorkoutStep = ExerciseStep | RestStep | RepeatBlock;
export type Workout = z.infer<typeof WorkoutSchema>;

/**
 * Leaf steps in a step tree, recursing into repeat blocks: a workout built as
 * one block of six exercises is six steps, not one. Rounds are deliberately not
 * multiplied in — the count says what the workout *contains*, so editing a
 * round count does not swing it.
 *
 * Lives beside the schema that defines the tree so every consumer that needs to
 * walk it — the library summary, a future duration estimate, the `src/connect/`
 * converters — shares one definition of "descend into repeat, else leaf".
 */
export function countLeafSteps(steps: WorkoutStep[]): number {
  return steps.reduce(
    (total, step) => total + (step.kind === 'repeat' ? countLeafSteps(step.steps) : 1),
    0,
  );
}
