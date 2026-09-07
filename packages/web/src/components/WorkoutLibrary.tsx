import { useEffect, useRef, useState } from 'react';
import { useWorkoutStore } from '../store/workoutStore.ts';

function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default function WorkoutLibrary() {
  const summaries = useWorkoutStore((s) => s.summaries);
  const unreadable = useWorkoutStore((s) => s.unreadable);
  const status = useWorkoutStore((s) => s.status);
  const loadLibrary = useWorkoutStore((s) => s.loadLibrary);
  const createWorkout = useWorkoutStore((s) => s.createWorkout);
  const openWorkout = useWorkoutStore((s) => s.openWorkout);
  const duplicateWorkout = useWorkoutStore((s) => s.duplicateWorkout);
  const deleteWorkout = useWorkoutStore((s) => s.deleteWorkout);
  const exportWorkout = useWorkoutStore((s) => s.exportWorkout);
  const importWorkoutFile = useWorkoutStore((s) => s.importWorkoutFile);

  const fileInput = useRef<HTMLInputElement>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  async function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset first so re-picking the same file fires another change event.
    event.target.value = '';
    if (file) await importWorkoutFile(await file.text());
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold tracking-tight">Your workouts</h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
            onClick={() => fileInput.current?.click()}
          >
            Import backup
          </button>
          <button
            type="button"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            onClick={() => void createWorkout()}
          >
            New workout
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            aria-label="Import workout backup"
            onChange={(event) => void handleImport(event)}
          />
        </div>
      </div>

      {unreadable.length > 0 && (
        <p className="rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {unreadable.length} saved workout{unreadable.length === 1 ? '' : 's'} could not be read
          and {unreadable.length === 1 ? 'is' : 'are'} hidden.
        </p>
      )}

      {status === 'loading' && <p className="text-sm text-gray-500">Loading your library…</p>}

      {status !== 'loading' && summaries.length === 0 && (
        <div className="rounded-md border border-dashed border-gray-300 px-6 py-10 text-center">
          <p className="font-medium text-gray-900">No workouts yet</p>
          <p className="mt-1 text-sm text-gray-600">
            Create one to get started. Everything stays in this browser — no account, no server.
          </p>
        </div>
      )}

      {summaries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {summaries.map((summary) => (
            <li
              key={summary.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 px-4 py-3"
            >
              <div>
                <button
                  type="button"
                  className="font-medium text-gray-900 underline-offset-2 hover:underline"
                  onClick={() => void openWorkout(summary.id)}
                >
                  {summary.name}
                </button>
                <p className="text-sm text-gray-500">
                  {summary.stepCount} step{summary.stepCount === 1 ? '' : 's'} · updated{' '}
                  {formatUpdatedAt(summary.updatedAt)}
                </p>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
                  onClick={() => void duplicateWorkout(summary.id)}
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
                  onClick={() => void exportWorkout(summary.id)}
                >
                  Export backup
                </button>
                {pendingDelete === summary.id ? (
                  <>
                    <button
                      type="button"
                      className="rounded-md bg-red-600 px-2.5 py-1 text-white hover:bg-red-700"
                      onClick={() => {
                        setPendingDelete(null);
                        void deleteWorkout(summary.id);
                      }}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
                      onClick={() => setPendingDelete(null)}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-red-700 hover:bg-red-50"
                    onClick={() => setPendingDelete(summary.id)}
                  >
                    Delete
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
