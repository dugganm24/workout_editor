import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SCHEMA_VERSION } from '@workout-editor/core';
import { getDb, WORKOUT_STORE } from '../storage/db.ts';
import * as storage from '../storage/workouts.ts';
import { useWorkoutStore } from '../store/workoutStore.ts';
import WorkoutLibrary from './WorkoutLibrary.tsx';

describe('WorkoutLibrary', () => {
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

  it('renames a workout from the library view', async () => {
    const user = userEvent.setup();
    await useWorkoutStore.getState().createWorkout('Push Day');
    render(<WorkoutLibrary />);

    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Rename Push Day' });
    await user.clear(input);
    await user.type(input, 'Pull Day{Enter}');

    await waitFor(() => expect(useWorkoutStore.getState().summaries[0]?.name).toBe('Pull Day'));
    expect(await screen.findByRole('button', { name: 'Pull Day' })).toBeInTheDocument();
  });

  it('abandons a rename on Escape', async () => {
    const user = userEvent.setup();
    await useWorkoutStore.getState().createWorkout('Push Day');
    render(<WorkoutLibrary />);

    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Rename Push Day' }), 'X{Escape}');

    expect(await screen.findByRole('button', { name: 'Push Day' })).toBeInTheDocument();
    expect(useWorkoutStore.getState().summaries[0]?.name).toBe('Push Day');
  });

  it('disables Export all until there is something to export', async () => {
    render(<WorkoutLibrary />);
    expect(await screen.findByRole('button', { name: 'Export all' })).toBeDisabled();
  });

  it('offers a retry when a reload fails, even with a list still on screen', async () => {
    await useWorkoutStore.getState().createWorkout('Push Day');
    useWorkoutStore.getState().closeWorkout();
    render(<WorkoutLibrary />);
    await screen.findByRole('button', { name: 'Push Day' });

    const failing = vi.spyOn(storage, 'listWorkouts').mockRejectedValue(new Error('storage gone'));
    await useWorkoutStore.getState().loadLibrary();
    failing.mockRestore();

    // The stale rows stay, but the user is told and given a way out.
    expect(screen.getByRole('button', { name: 'Push Day' })).toBeInTheDocument();
    expect(screen.getByText('Your library could not be refreshed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not claim the library is empty when records are only unreadable', async () => {
    const db = await getDb();
    await db.put(WORKOUT_STORE, {
      id: 'bad',
      seq: 1,
      updatedAt: Date.now(),
      workout: { schemaVersion: SCHEMA_VERSION, id: 'bad', sport: 'strength' },
    } as never);

    render(<WorkoutLibrary />);

    expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
    expect(screen.queryByText('No workouts yet')).not.toBeInTheDocument();
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
