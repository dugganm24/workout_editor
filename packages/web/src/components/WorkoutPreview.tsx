import { useEffect, useState } from 'react';
import type { Workout } from '@workout-editor/core';
import { useWorkoutStore } from '../store/workoutStore.ts';
import StepList from './StepList.tsx';

/**
 * Read-only view of one workout. Step editing arrives with the builder UI;
 * until then this confirms what was saved and keeps the name editable.
 */
export default function WorkoutPreview({ workout }: { workout: Workout }) {
  const closeWorkout = useWorkoutStore((s) => s.closeWorkout);
  const renameWorkout = useWorkoutStore((s) => s.renameWorkout);
  const exportWorkout = useWorkoutStore((s) => s.exportWorkout);
  const duplicateWorkout = useWorkoutStore((s) => s.duplicateWorkout);

  const [name, setName] = useState(workout.name);

  // Re-sync when a different workout is opened, or the name changes elsewhere.
  useEffect(() => setName(workout.name), [workout.id, workout.name]);

  async function commitName() {
    // The store owns the naming rules — trimming, rejecting a blank name, and
    // skipping a no-op. Pre-checking here is how this view and the library
    // drifted into disagreeing about what a blank name does.
    await renameWorkout(workout.id, name);
    setName(useWorkoutStore.getState().currentWorkout?.name ?? name);
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <button
          type="button"
          className="text-sm text-gray-600 underline-offset-2 hover:underline"
          onClick={closeWorkout}
        >
          ← Back to library
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex-1">
          <span className="sr-only">Workout name</span>
          <input
            className="w-full rounded-md border border-transparent px-2 py-1 text-2xl font-semibold tracking-tight hover:border-gray-300 focus:border-gray-400 focus:outline-none"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setName(workout.name);
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
            onClick={() => void exportWorkout(workout.id)}
          >
            Export backup
          </button>
        </div>
      </div>

      <p className="rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-900">
        This is a read-only preview. Step editing arrives with the strength workout builder.
      </p>

      <StepList steps={workout.steps} />
    </section>
  );
}
