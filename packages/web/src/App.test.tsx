import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App.tsx';
import { useWorkoutStore } from './store/workoutStore.ts';

describe('App', () => {
  it('renders the landing shell', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Workout Editor' })).toBeInTheDocument();
  });

  // The store's error is set from nine places; this is the only assertion that
  // any of them reaches the screen.
  it('shows a store error and dismisses it', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Let the mount load settle first: loadLibrary clears `error` by design.
    await screen.findByText('No workouts yet');

    await useWorkoutStore.getState().openWorkout('gone');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That workout is no longer in your library.',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('routes to the open workout when one is set', async () => {
    await useWorkoutStore.getState().createWorkout('Push Day');
    render(<App />);

    expect(await screen.findByRole('textbox', { name: 'Workout name' })).toHaveValue('Push Day');
  });
});
