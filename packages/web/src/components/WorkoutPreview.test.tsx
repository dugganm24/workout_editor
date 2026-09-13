import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as files from '../storage/files.ts';
import { useWorkoutStore } from '../store/workoutStore.ts';
import WorkoutPreview from './WorkoutPreview.tsx';

/** Creates a workout and returns it as the open one. */
async function open(name: string) {
  await useWorkoutStore.getState().createWorkout(name);
  const workout = useWorkoutStore.getState().currentWorkout;
  if (!workout) throw new Error('createWorkout did not open the workout');
  return workout;
}

describe('WorkoutPreview', () => {
  it('renames the open workout through the store', async () => {
    const user = userEvent.setup();
    render(<WorkoutPreview workout={await open('Push Day')} />);

    const input = screen.getByRole('textbox', { name: 'Workout name' });
    await user.clear(input);
    await user.type(input, 'Pull Day');
    await user.tab();

    await waitFor(() => expect(useWorkoutStore.getState().currentWorkout?.name).toBe('Pull Day'));
    expect(useWorkoutStore.getState().error).toBeNull();
  });

  it('reports a blank name rather than silently reverting', async () => {
    // The library view surfaces this error; both views must agree.
    const user = userEvent.setup();
    render(<WorkoutPreview workout={await open('Push Day')} />);

    const input = screen.getByRole('textbox', { name: 'Workout name' });
    await user.clear(input);
    await user.tab();

    await waitFor(() => expect(useWorkoutStore.getState().error).toBe('A workout needs a name.'));
    expect(input).toHaveValue('Push Day');
  });

  it('exports the name just typed, not the one still in storage', async () => {
    const user = userEvent.setup();
    const download = vi.spyOn(files, 'downloadWorkoutJson').mockImplementation(() => undefined);
    render(<WorkoutPreview workout={await open('Push Day')} />);

    const input = screen.getByRole('textbox', { name: 'Workout name' });
    await user.clear(input);
    await user.type(input, 'Pull Day');
    // Clicking blurs the field, which commits the rename; the export must wait
    // for that write rather than racing it.
    await user.click(screen.getByRole('button', { name: 'Export backup' }));

    await waitFor(() => expect(download).toHaveBeenCalled());
    expect(download.mock.calls[0]?.[0]?.name).toBe('Pull Day');
    download.mockRestore();
  });

  it('leaves the name alone when it has not changed', async () => {
    const user = userEvent.setup();
    const workout = await open('Push Day');
    const before = useWorkoutStore.getState().summaries[0]?.updatedAt;
    render(<WorkoutPreview workout={workout} />);

    await user.click(screen.getByRole('textbox', { name: 'Workout name' }));
    await user.tab();

    await waitFor(() => expect(useWorkoutStore.getState().error).toBeNull());
    expect(useWorkoutStore.getState().summaries[0]?.updatedAt).toBe(before);
  });
});
