import { SCHEMA_VERSION } from '@workout-editor/core';
import WorkoutLibrary from './components/WorkoutLibrary.tsx';
import WorkoutPreview from './components/WorkoutPreview.tsx';
import { useWorkoutStore } from './store/workoutStore.ts';

export default function App() {
  const currentWorkout = useWorkoutStore((s) => s.currentWorkout);
  const error = useWorkoutStore((s) => s.error);
  const clearError = useWorkoutStore((s) => s.clearError);

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-6 sm:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-gray-200 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Workout Editor</h1>
        <p className="text-sm text-gray-400">
          Under construction — workout schema v{SCHEMA_VERSION}.{' '}
          <a
            className="underline hover:text-gray-600"
            href="https://github.com/dugganm24/workout_editor"
          >
            GitHub
          </a>
        </p>
      </header>

      {error && (
        <p
          role="alert"
          className="flex items-start justify-between gap-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span>{error}</span>
          <button type="button" className="underline" onClick={clearError}>
            Dismiss
          </button>
        </p>
      )}

      <main className="flex-1">
        {currentWorkout ? <WorkoutPreview workout={currentWorkout} /> : <WorkoutLibrary />}
      </main>
    </div>
  );
}
