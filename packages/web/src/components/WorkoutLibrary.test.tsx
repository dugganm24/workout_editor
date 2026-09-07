import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetDb } from '../storage/testing.ts';
import { useWorkoutStore } from '../store/workoutStore.ts';
import WorkoutLibrary from './WorkoutLibrary.tsx';

describe('WorkoutLibrary', () => {
  beforeEach(async () => {
    await resetDb();
    useWorkoutStore.setState({
      summaries: [],
      unreadable: [],
      currentWorkout: null,
      status: 'idle',
      error: null,
    });
  });

  it('shows the empty state when nothing is saved', async () => {
    render(<WorkoutLibrary />);
    expect(await screen.findByText('No workouts yet')).toBeInTheDocument();
  });

  it('lists saved workouts and opens one', async () => {
    const user = userEvent.setup();
    await useWorkoutStore.getState().createWorkout('Push Day');
    useWorkoutStore.setState({ currentWorkout: null });

    render(<WorkoutLibrary />);

    const link = await screen.findByRole('button', { name: 'Push Day' });
    expect(screen.getByText(/0 steps · updated/)).toBeInTheDocument();

    await user.click(link);
    await waitFor(() => expect(useWorkoutStore.getState().currentWorkout?.name).toBe('Push Day'));
  });

  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    await useWorkoutStore.getState().createWorkout('Push Day');
    render(<WorkoutLibrary />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    // Still there until confirmed.
    expect(useWorkoutStore.getState().summaries).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    await waitFor(() => expect(useWorkoutStore.getState().summaries).toEqual([]));
  });

  it('duplicates a workout from the list', async () => {
    const user = userEvent.setup();
    await useWorkoutStore.getState().createWorkout('Push Day');
    render(<WorkoutLibrary />);

    await user.click(await screen.findByRole('button', { name: 'Duplicate' }));

    await waitFor(() => expect(useWorkoutStore.getState().summaries).toHaveLength(2));
    expect(await screen.findByRole('button', { name: 'Push Day (copy)' })).toBeInTheDocument();
  });
});
