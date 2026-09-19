import { IDBFactory } from 'fake-indexeddb';
import { closeDb } from './storage/db.ts';
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
  // Then drop whatever that could not write. A failed save keeps its edit
  // pending, and the flush above fails the same way, so without this the next
  // test inherits it and sees its own first action report a workout it never
  // opened. Discarding is the only thing that reaches that module-level state.
  await useWorkoutStore.getState().flushSteps();
  useWorkoutStore.getState().discardChanges();
  await useWorkoutStore.getState().loadLibrary();
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
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
