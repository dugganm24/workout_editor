import { useState } from 'react';
import { SCHEMA_VERSION } from '@workout-editor/core';
import WorkoutLibrary from './components/WorkoutLibrary.tsx';
import WorkoutEditor from './components/WorkoutEditor.tsx';
import { useWorkoutStore } from './store/workoutStore.ts';

const HELP_SEEN_KEY = 'workout-editor:connect-help-seen';

/** Open on first visit until closed once; the summary line stays as the help link. */
function ConnectHelp() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(HELP_SEEN_KEY) === null;
    } catch {
      return true;
    }
  });

  return (
    <details
      open={open}
      className="rounded-md border border-gray-200 px-4 py-3 text-sm text-gray-700"
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        try {
          localStorage.setItem(HELP_SEEN_KEY, '1');
        } catch {
          // Shows open again next visit; nothing is lost.
        }
      }}
    >
      <summary className="cursor-pointer font-medium text-gray-900">
        How to get a workout onto your Garmin watch
      </summary>
      <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
        <li>
          Install the free{' '}
          <a
            className="underline"
            href="https://chromewebstore.google.com/detail/share-your-garmin-connect/kdpolhnlnkengkmfncjdbfdehglepmff"
          >
            Share your Garmin Connect workout
          </a>{' '}
          Chrome extension.
        </li>
        <li>
          Click <strong>Export to Garmin</strong> on a workout here to download its Connect JSON
          file.
        </li>
        <li>
          On the{' '}
          <a className="underline" href="https://connect.garmin.com/modern/workouts">
            connect.garmin.com
          </a>{' '}
          workouts page, click the extension&rsquo;s <strong>Import Workout</strong> button and pick
          the file.
        </li>
        <li>It syncs to your watch like any other Connect workout.</li>
      </ol>
      <p className="mt-2 text-gray-500">
        Going the other way, export a workout from Connect with the extension and use{' '}
        <strong>Import</strong> here to edit it.
      </p>
    </details>
  );
}

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

      <ConnectHelp />

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
        {currentWorkout ? <WorkoutEditor workout={currentWorkout} /> : <WorkoutLibrary />}
      </main>
    </div>
  );
}
