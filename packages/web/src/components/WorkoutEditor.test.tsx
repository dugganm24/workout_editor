import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useWorkoutStore } from '../store/workoutStore.ts';
import WorkoutEditor from './WorkoutEditor.tsx';

const store = () => useWorkoutStore.getState();

/**
 * Renders whatever workout is open, the way `App` does. The editor takes the
 * workout as a prop, so a test that passed a snapshot of it would stop seeing
 * its own edits after the first one.
 */
function OpenWorkout() {
  const workout = useWorkoutStore((s) => s.currentWorkout);
  return workout ? <WorkoutEditor workout={workout} /> : null;
}

/** Opens a workout and puts the editor on screen. */
async function openEditor(name = 'Push Day') {
  await store().createWorkout(name);
  render(<OpenWorkout />);
  return userEvent.setup();
}

const exerciseNames = () =>
  screen.getAllByLabelText('Exercise').map((input) => (input as HTMLInputElement).value);

const savedSteps = async () => {
  await store().flushSteps();
  const id = store().currentWorkout!.id;
  const { getWorkout } = await import('../storage/workouts.ts');
  return (await getWorkout(id))?.steps ?? [];
};

describe('WorkoutEditor', () => {
  it('starts empty and adds a first exercise, focused and ready to name', async () => {
    const user = await openEditor();
    expect(screen.getByText(/No steps yet/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    const name = screen.getByLabelText('Exercise');
    expect(name).toHaveFocus();
    await user.type(name, 'Back Squat');

    expect(store().currentWorkout?.steps).toHaveLength(1);
    await waitFor(async () =>
      expect(await savedSteps()).toMatchObject([{ kind: 'exercise', exercise: 'Back Squat' }]),
    );
  });

  it('adds the next step of the same kind on Enter, without touching the mouse', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Bench Press');

    // Enter from inside the row: a second exercise, focused, ready to type.
    await user.keyboard('{Enter}');
    expect(exerciseNames()).toEqual(['Bench Press', '']);
    expect(screen.getAllByLabelText('Exercise')[1]).toHaveFocus();

    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Overhead Press');
    expect(exerciseNames()).toEqual(['Bench Press', 'Overhead Press']);

    // A rest row does the same, and adds a rest rather than an exercise.
    await user.click(screen.getByRole('button', { name: '+ Rest' }));
    await user.keyboard('{Enter}');
    expect(screen.getAllByText('Rest')).toHaveLength(2);
  });

  it('reorders with Alt+arrow and keeps the cursor on the step that moved', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'First');
    await user.keyboard('{Enter}');
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Second');

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(exerciseNames()).toEqual(['Second', 'First']);
    // Focus followed the step, so the next Alt+↑ acts on the same row.
    expect(screen.getAllByLabelText('Exercise')[0]).toHaveFocus();
    await waitFor(async () =>
      expect(
        (await savedSteps()).map((s) => (s.kind === 'exercise' ? s.exercise : s.kind)),
      ).toEqual(['Second', 'First']),
    );
  });

  it('keeps Enter and Alt+arrow inside a block to the row they were pressed in', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'After');
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Inner');

    // One exercise inside the block, and no second block after it.
    await user.keyboard('{Enter}');
    expect(store().currentWorkout?.steps).toMatchObject([
      { exercise: 'After' },
      { kind: 'repeat', steps: [{ exercise: 'Inner' }, { kind: 'exercise' }] },
    ]);
    expect(screen.getAllByLabelText('Exercise')[2]).toHaveFocus();

    // Moving the new step up swaps it within the block; the block stays put.
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(store().currentWorkout?.steps).toMatchObject([
      { exercise: 'After' },
      { kind: 'repeat', steps: [{ kind: 'exercise' }, { exercise: 'Inner' }] },
    ]);
    expect(screen.getAllByLabelText('Exercise')[1]).toHaveFocus();
  });

  it('leaves Enter on a row button to the button', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Deadlift');

    screen.getByRole('button', { name: 'Delete Deadlift' }).focus();
    await user.keyboard('{Enter}');

    expect(store().currentWorkout?.steps).toEqual([]);
  });

  it('keeps the cursor on a lap-press rest as it moves', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Rest' }));
    // A rest that ends on a lap press has no number box to focus.
    await user.selectOptions(screen.getAllByLabelText('Duration type')[1]!, 'open');

    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(store().currentWorkout?.steps).toMatchObject([{ kind: 'rest' }, { kind: 'exercise' }]);
    expect(screen.getAllByLabelText('Duration type')[0]).toHaveFocus();
  });

  it('highlights the row inside a block that a drag is over, not the block', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Outer');
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Inner');

    const handles = screen.getAllByText('⠿');
    fireEvent.dragStart(handles[0]!);
    const inner = screen.getAllByLabelText('Exercise')[1]!.closest('li')!;
    const block = inner.parentElement!.closest('li')!;
    fireEvent.dragOver(inner);

    expect(inner).toHaveClass('border-gray-900');
    expect(block).not.toHaveClass('border-gray-900');

    fireEvent.drop(inner);
    expect(store().currentWorkout?.steps).toMatchObject([
      { kind: 'repeat', steps: [{ exercise: 'Outer' }, { exercise: 'Inner' }] },
    ]);
  });

  it('duplicates and deletes a step from its own row', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Deadlift');

    await user.click(screen.getByRole('button', { name: 'Duplicate Deadlift' }));
    expect(exerciseNames()).toEqual(['Deadlift', 'Deadlift']);

    await user.click(screen.getAllByRole('button', { name: 'Delete Deadlift' })[0]!);
    expect(exerciseNames()).toEqual(['Deadlift']);
  });

  it('switches how a step ends, and drops the fields that no longer apply', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    expect(screen.getByLabelText('Reps')).toHaveValue(8);

    await user.selectOptions(screen.getByLabelText('Duration type'), 'time');
    expect(screen.queryByLabelText('Reps')).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText('Seconds'));
    await user.type(screen.getByLabelText('Seconds'), '45');

    await user.selectOptions(screen.getByLabelText('Duration type'), 'open');
    expect(screen.queryByLabelText('Seconds')).not.toBeInTheDocument();

    await waitFor(async () =>
      expect(await savedSteps()).toMatchObject([{ duration: { type: 'open' } }]),
    );
  });

  it('keeps a half-typed number out of the model, and clears an optional one', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    const weight = screen.getByLabelText('Weight in kilograms');
    await user.type(weight, '100');
    expect(store().currentWorkout?.steps[0]).toMatchObject({ target: { kg: 100 } });

    // Emptying an optional field removes the target rather than saving a zero.
    await user.clear(weight);
    expect(store().currentWorkout?.steps[0]).not.toHaveProperty('target.kg');

    // A required one refuses the empty value and keeps the last good number.
    const reps = screen.getByLabelText('Reps');
    await user.clear(reps);
    expect(store().currentWorkout?.steps[0]).toMatchObject({ duration: { reps: 8 } });
    await user.type(reps, '5');
    expect(store().currentWorkout?.steps[0]).toMatchObject({ duration: { reps: 5 } });
  });

  it('builds a repeat block, edits inside it, and drops it when it empties', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));

    // A block arrives with a step in it: an empty one could not be saved.
    expect(screen.getByLabelText('Rounds')).toHaveValue(3);
    await user.clear(screen.getByLabelText('Rounds'));
    await user.type(screen.getByLabelText('Rounds'), '5');
    await user.type(screen.getByLabelText('Exercise'), 'Squat');

    // Nested add buttons put the step inside the block.
    await user.click(screen.getAllByRole('button', { name: '+ Rest' })[0]!);
    expect(store().currentWorkout?.steps).toMatchObject([
      { kind: 'repeat', rounds: 5, steps: [{ exercise: 'Squat' }, { kind: 'rest' }] },
    ]);

    await user.click(screen.getByRole('button', { name: 'Delete rest' }));
    await user.click(screen.getByRole('button', { name: 'Delete Squat' }));

    // Emptied, the block goes with its last step rather than becoming unsavable.
    expect(store().currentWorkout?.steps).toEqual([]);
    await waitFor(async () => expect(await savedSteps()).toEqual([]));
  });

  it('counts leaf steps, including the ones inside a block', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.click(screen.getAllByRole('button', { name: '+ Rest' })[0]!);
    await user.click(screen.getAllByRole('button', { name: '+ Exercise' }).at(-1)!);

    // Two inside the block, one outside; rounds are not multiplied in.
    expect(screen.getByText('3 steps')).toBeInTheDocument();
  });

  it('writes pending edits when the workout is closed', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Row');

    const id = store().currentWorkout!.id;
    await user.click(screen.getByRole('button', { name: '← Back to library' }));
    await store().flushSteps();

    const { getWorkout } = await import('../storage/workouts.ts');
    expect((await getWorkout(id))?.steps).toMatchObject([{ exercise: 'Row' }]);
    expect(store().currentWorkout).toBeNull();
  });
});
