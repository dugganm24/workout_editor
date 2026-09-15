import { resetDb } from './storage/testing.ts';
import { clearAllUnsaved } from './storage/unsaved.ts';
import { useWorkoutStore } from './store/workoutStore.ts';

/**
 * A clean database *and* a clean store. Kept together so a field added to
 * `WorkoutState` cannot be reset in one test file and forgotten in another.
 */
export async function resetApp(): Promise<void> {
  // Drain the store's action queue before anything else. A test that renders
  // the app without awaiting the mount's `loadLibrary` leaves that action
  // queued, holding the connection this reset is about to close; when it
  // resumes it throws and writes `error`/`status: 'error'` into the *next*
  // test's state. Actions run in order, so awaiting one more waits out
  // everything queued ahead of it — `loadLibrary` is the one that changes
  // nothing and cannot reject.
  // Cancels the autosave timer too, which no amount of draining would catch:
  // it is not queued work yet, and would fire into the next test's database.
  await useWorkoutStore.getState().flushSteps();
  await useWorkoutStore.getState().loadLibrary();
  await resetDb();
  clearAllUnsaved();
  useWorkoutStore.setState({
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'loading',
    error: null,
    saveError: null,
  });
}
