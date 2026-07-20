import { z } from 'zod';

/**
 * Canonical workout model. This is the editor's own format — Garmin Connect
 * JSON (and any future targets like FIT) are compile targets converted to and
 * from this shape in `src/connect/`.
 *
 * `schemaVersion` gates forward migrations: any breaking change to these
 * schemas bumps the version and adds a migration so saved/shared workouts
 * never break on upgrade.
 */

export const SCHEMA_VERSION = 1;

export const WeightTargetSchema = z.object({
  type: z.literal('weight'),
  /** Weight in kilograms; display unit conversion happens in the UI. */
  kg: z.number().positive(),
});

export const ExerciseStepSchema = z.object({
  kind: z.literal('exercise'),
  /** Exercise category key, e.g. "BENCH_PRESS". Taxonomy lives in src/exercises/. */
  category: z.string().min(1),
  /** Specific exercise key within the category, e.g. "BARBELL_BENCH_PRESS". */
  exercise: z.string().min(1).optional(),
  duration: z.discriminatedUnion('type', [
    z.object({ type: z.literal('reps'), reps: z.number().int().positive() }),
    z.object({ type: z.literal('time'), seconds: z.number().positive() }),
    z.object({ type: z.literal('open') }),
  ]),
  target: WeightTargetSchema.optional(),
  notes: z.string().optional(),
});

export const RestStepSchema = z.object({
  kind: z.literal('rest'),
  duration: z.discriminatedUnion('type', [
    z.object({ type: z.literal('time'), seconds: z.number().positive() }),
    z.object({ type: z.literal('open') }),
  ]),
});

export const RepeatBlockSchema = z.object({
  kind: z.literal('repeat'),
  rounds: z.number().int().min(1),
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
  steps: z.array(WorkoutStepSchema).min(1),
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
