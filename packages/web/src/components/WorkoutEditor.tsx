import { useState } from 'react';
import { countLeafSteps, type Workout } from '@workout-editor/core';
import { useWorkoutStore } from '../store/workoutStore.ts';
import StepEditor, { AddStepButtons, StepEditorProvider } from './StepEditor.tsx';

/**
 * The workout being built. Everything here edits in place and saves itself —
 * there is no save button, and the library list updates as the writes land.
 */
export default function WorkoutEditor({ workout }: { workout: Workout }) {
  const closeWorkout = useWorkoutStore((s) => s.closeWorkout);
  const renameWorkout = useWorkoutStore((s) => s.renameWorkout);
  const exportWorkout = useWorkoutStore((s) => s.exportWorkout);
  const duplicateWorkout = useWorkoutStore((s) => s.duplicateWorkout);
  const editSteps = useWorkoutStore((s) => s.editSteps);
  const saveError = useWorkoutStore((s) => s.saveError);
  const flushSteps = useWorkoutStore((s) => s.flushSteps);
  const discardChanges = useWorkoutStore((s) => s.discardChanges);

  /**
   * An edit buffer, null when not editing, rather than a copy of the prop. The
   * stored name then flows in through normal rendering: no effect to re-sync
   * it, and nothing to reconcile when it changes elsewhere.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? workout.name;
  const stepCount = countLeafSteps(workout.steps);

  async function commitName() {
    if (draft === null) return;
    setDraft(null);
    // The store owns the naming rules — trimming, rejecting a blank name, and
    // skipping a no-op. Pre-checking here is how this view and the library
    // drifted into disagreeing about what a blank name does.
    await renameWorkout(workout.id, draft);
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          className="text-sm text-gray-600 underline-offset-2 hover:underline"
          onClick={() => void closeWorkout()}
        >
          ← Back to library
        </button>
      </div>

      {/* Stands until the edits are written or discarded: unlike the app's
          one-off error banner, it describes a state the workout is still in. */}
      {saveError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>
            Your latest changes have not been saved: {saveError}. They are kept on this page and
            retried as you edit.
          </span>
          <div className="flex gap-3">
            <button type="button" className="underline" onClick={() => void flushSteps()}>
              Try again
            </button>
            <button type="button" className="underline" onClick={discardChanges}>
              Discard changes
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex-1">
          <span className="sr-only">Workout name</span>
          <input
            className="w-full rounded-md border border-transparent px-2 py-1 text-2xl font-semibold tracking-tight hover:border-gray-300 focus:border-gray-400 focus:outline-none"
            value={name}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setDraft(null);
            }}
          />
        </label>
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
            onClick={() => void duplicateWorkout(workout.id)}
          >
            Duplicate
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
            onClick={() => void exportWorkout(workout.id, 'connect')}
          >
            Export to Garmin
          </button>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
            onClick={() => void exportWorkout(workout.id)}
          >
            Export backup
          </button>
        </div>
      </div>

      <StepEditorProvider edit={editSteps}>
        <div className="flex flex-col gap-4">
          {workout.steps.length === 0 ? (
            <p className="rounded-md border border-dashed border-gray-300 px-6 py-8 text-center text-sm text-gray-600">
              No steps yet. Add an exercise to start building.
            </p>
          ) : (
            <StepEditor steps={workout.steps} path={[]} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <AddStepButtons steps={workout.steps} path={[]} />
            <p className="text-sm text-gray-500">
              {stepCount} step{stepCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </StepEditorProvider>

      {/* The keyboard path is the point of this editor, so it is written down
          rather than left to be discovered. */}
      <p className="text-xs text-gray-400">
        Enter adds the next step of the same kind · Alt+↑/↓ moves a step · Tab moves between fields
        · changes save themselves
      </p>
    </section>
  );
}
