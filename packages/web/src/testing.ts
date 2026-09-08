import { resetDb } from './storage/testing.ts';
import { useWorkoutStore } from './store/workoutStore.ts';

/**
 * A clean database *and* a clean store. Kept together so a field added to
 * `WorkoutState` cannot be reset in one test file and forgotten in another.
 */
export async function resetApp(): Promise<void> {
  await resetDb();
  useWorkoutStore.setState({
    summaries: [],
    unreadable: [],
    currentWorkout: null,
    status: 'loading',
    error: null,
  });
}
