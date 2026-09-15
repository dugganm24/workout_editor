import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
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

/** A named exercise, as an imported or earlier-built workout would hold it. */
const exercise = (name: string) =>
  ({
    kind: 'exercise',
    category: 'UNKNOWN',
    exercise: name,
    duration: { type: 'reps', reps: 5 },
  }) as const;

const exerciseNames = () =>
  screen.getAllByLabelText('Exercise').map((input) => (input as HTMLInputElement).value);

const savedSteps = async () => {
  await store().flushSteps();
  const id = store().currentWorkout!.id;
  const { getWorkout } = await import('../storage/workouts.ts');
  return (await getWorkout(id))?.steps ?? [];
};

/** The drop zones a drag shows at the end of every list. */
const tailZones = () => document.querySelectorAll('li.border-dashed');

/** Starts a drag; the drop zones appear once `dragstart` has returned, as in a browser. */
async function startDrag(handle: Element) {
  fireEvent.dragStart(handle);
  await waitFor(() => expect(tailZones().length).toBeGreaterThan(0));
}

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
    await startDrag(handles[0]!);
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

  it('moves the cursor off Delete, so a second Enter cannot delete the next step', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Bench');
    await user.keyboard('{Enter}');
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Squat');

    screen.getByRole('button', { name: 'Delete Bench' }).focus();
    await user.keyboard('{Enter}');

    expect(exerciseNames()).toEqual(['Squat']);
    // The step that took its place, not that step's own Delete button.
    expect(screen.getByLabelText('Exercise')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(exerciseNames()).toEqual(['Squat', '']);
  });

  it('keeps the cursor on the control that moved a step', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'First');
    await user.keyboard('{Enter}');
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'Second');

    // The button keeps the cursor, so Enter presses it again rather than adding
    // a step from the name box (here it is last, so nothing moves).
    await user.click(screen.getByRole('button', { name: 'Move First down' }));
    expect(exerciseNames()).toEqual(['Second', 'First']);
    expect(screen.getByRole('button', { name: 'Move First down' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(exerciseNames()).toEqual(['Second', 'First']);

    // A field: the weight box stays focused, and typing does not replace the name.
    const weight = screen.getAllByLabelText('Weight in kilograms')[1]!;
    await user.click(weight);
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(screen.getAllByLabelText('Weight in kilograms')[0]).toHaveFocus();
    await user.keyboard('5');
    expect(exerciseNames()).toEqual(['First', 'Second']);
    expect(store().currentWorkout?.steps[0]).toMatchObject({ target: { kg: 5 } });
  });

  it('does not leave a focus request behind when a move changes nothing', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.click(screen.getAllByRole('button', { name: '+ Rest' })[0]!);

    // The block is last: moving it down changes nothing, and must not queue
    // the cursor for a row at [2] that does not exist yet.
    await user.click(screen.getByLabelText('Rounds'));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    // Dragging the rest out to the end creates that row, without asking for focus.
    const handles = screen.getAllByText('⠿');
    await startDrag(handles.at(-1)!);
    const tails = document.querySelectorAll('li.border-dashed');
    fireEvent.dragOver(tails[tails.length - 1]!);
    fireEvent.drop(tails[tails.length - 1]!);

    expect(store().currentWorkout?.steps.map((s) => s.kind)).toEqual([
      'exercise',
      'repeat',
      'rest',
    ]);
    expect(screen.getAllByLabelText('Seconds').at(-1)).not.toHaveFocus();
  });

  it('leaves the Enter that confirms an IME candidate to the composition', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    fireEvent.keyDown(screen.getByLabelText('Exercise'), { key: 'Enter', isComposing: true });

    expect(store().currentWorkout?.steps).toHaveLength(1);
  });

  it('changes no layout while dragstart is still being handled', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.click(screen.getAllByRole('button', { name: '+ Exercise' }).at(-1)!);

    // Chrome can cancel a drag whose handle moves during `dragstart`.
    fireEvent.dragStart(screen.getAllByText('⠿').at(-1)!);
    expect(tailZones()).toHaveLength(0);
    await waitFor(() => expect(tailZones()).toHaveLength(2));
  });

  it('does not re-render the tree for every dragover on the same spot', async () => {
    let commits = 0;
    await store().createWorkout('Push Day');
    render(
      <Profiler id="editor" onRender={() => commits++}>
        <OpenWorkout />
      </Profiler>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Rest' }));

    await startDrag(screen.getAllByText('⠿')[0]!);
    const tail = tailZones()[0]!;
    // Two to settle: React may render once more before it starts skipping an
    // unchanged state, which is its own bookkeeping rather than a re-render per event.
    fireEvent.dragOver(tail);
    fireEvent.dragOver(tail);
    const settled = commits;
    for (let i = 0; i < 10; i++) fireEvent.dragOver(tail);

    expect(commits).toBe(settled);
  });

  it('shows an imported step by its humanized Garmin names, read-only', async () => {
    await store().createWorkout('Imported');
    store().editSteps(() => [
      { kind: 'exercise', category: 'PLANK', duration: { type: 'open' }, notes: 'Keep hips level' },
      {
        kind: 'exercise',
        category: 'BENCH_PRESS',
        exercise: 'BARBELL_BENCH_PRESS',
        duration: { type: 'reps', reps: 5 },
      },
    ]);
    render(<OpenWorkout />);

    // A key edited by hand would be one that exists nowhere, so there is no box to edit it in.
    expect(screen.queryByLabelText('Exercise')).not.toBeInTheDocument();
    expect(screen.getByText('Plank')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Plank' })).toBeInTheDocument();
    expect(screen.getByText('Keep hips level')).toBeInTheDocument();

    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Barbell Bench Press' })).toBeInTheDocument();
  });

  it('shows no category for a step the editor added itself', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete exercise' })).toBeInTheDocument();
  });

  it('after a delete that empties a block, puts the cursor on the next step, not inside it', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [
      { kind: 'repeat', rounds: 3, steps: [{ ...exercise('X') }] },
      { kind: 'repeat', rounds: 2, steps: [{ ...exercise('Y') }] },
    ]);
    render(<OpenWorkout />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Delete X' }));

    // The second block took the first one's place: its own first field, not Y's.
    expect(exerciseNames()).toEqual(['Y']);
    expect(screen.getByLabelText('Rounds')).toHaveFocus();

    // Nothing left: the add buttons, not the page body.
    await user.click(screen.getByRole('button', { name: 'Delete Y' }));
    expect(screen.getByRole('button', { name: '+ Exercise' })).toHaveFocus();
  });

  it("ignores Alt+arrow pressed on a block's own add buttons", async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [exercise('A'), { kind: 'repeat', rounds: 3, steps: [exercise('B')] }]);
    render(<OpenWorkout />);
    const user = userEvent.setup();

    screen.getAllByRole('button', { name: '+ Rest' })[0]!.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(store().currentWorkout?.steps.map((s) => s.kind)).toEqual(['exercise', 'repeat']);
  });

  it('drops in the gaps inside a block where the highlight already is', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [
      { kind: 'repeat', rounds: 3, steps: [exercise('B'), exercise('C')] },
      exercise('Z'),
    ]);
    render(<OpenWorkout />);

    await startDrag(screen.getAllByText('⠿').at(-1)!);
    const c = screen.getAllByLabelText('Exercise')[1]!.closest('li')!;
    const block = c.parentElement!.closest('li')!;
    fireEvent.dragOver(c);
    // Into the gap, or over the block's add buttons: neither belongs to a row.
    const nestedList = c.parentElement!;
    fireEvent.dragOver(nestedList);
    fireEvent.dragOver(screen.getAllByRole('button', { name: '+ Rest' })[0]!);

    expect(c).toHaveClass('border-gray-900');
    expect(block).not.toHaveClass('border-gray-900');
    fireEvent.drop(nestedList);
    expect(exerciseNames()).toEqual(['B', 'Z', 'C']);
  });

  it('keeps the drop target while the pointer crosses controls, until it leaves the tree', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [exercise('A'), exercise('B')]);
    render(<OpenWorkout />);

    await startDrag(screen.getAllByText('⠿')[0]!);
    const b = screen.getAllByLabelText('Exercise')[1]!.closest('li')!;
    fireEvent.dragOver(b);
    const [nameBox, repsBox] = [
      screen.getAllByLabelText('Exercise')[1]!,
      screen.getAllByLabelText('Reps')[1]!,
    ];
    // jsdom has no DragEvent, and only a MouseEvent carries `relatedTarget`.
    const leave = (from: Element, to: Element | null) =>
      act(() => {
        from.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: to }));
      });
    leave(nameBox, repsBox);
    expect(b).toHaveClass('border-gray-900');

    leave(b, null);
    expect(b).not.toHaveClass('border-gray-900');
  });

  it('renders each list as list items only', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [exercise('A'), { kind: 'repeat', rounds: 3, steps: [exercise('B')] }]);
    render(<OpenWorkout />);

    expect(document.querySelectorAll('ol > :not(li)')).toHaveLength(0);
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

  it('puts a number back when the box is left holding a value it rejected', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    const reps = screen.getByLabelText('Reps');
    await user.clear(reps);
    await user.type(reps, '12');
    await user.tab();

    // Backing out passes through 1, which the rule accepts, on the way to "".
    await user.click(reps);
    await user.keyboard('{Backspace}{Backspace}');
    expect(reps).toHaveAttribute('aria-invalid', 'true');
    await user.tab();

    expect(reps).toHaveValue(12);
    expect(reps).not.toHaveAttribute('aria-invalid');
    expect(store().currentWorkout?.steps[0]).toMatchObject({ duration: { reps: 12 } });

    // A value the box accepts is kept on leaving, including an optional one cleared.
    const weight = screen.getByLabelText('Weight in kilograms');
    await user.type(weight, '100');
    await user.clear(weight);
    await user.tab();
    expect(store().currentWorkout?.steps[0]).not.toHaveProperty('target.kg');
  });

  it("refuses a whole number too large for the model's integers", async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    const reps = screen.getByLabelText('Reps');
    await user.clear(reps);
    // Past 2^53: `Number.isInteger` says yes, the schema a save checks says no.
    await user.type(reps, '9007199254740993');

    const saved = store().currentWorkout?.steps[0];
    expect(saved?.kind === 'exercise' && saved.duration).toMatchObject({ type: 'reps' });
    const count =
      saved?.kind === 'exercise' && saved.duration.type === 'reps' && saved.duration.reps;
    expect(Number.isSafeInteger(count)).toBe(true);
    // And the workout still saves.
    await waitFor(async () => expect(await savedSteps()).toHaveLength(1));
    expect(store().error).toBeNull();
  });

  it('keeps an optional value while the box holds text it cannot parse yet', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    const weight = screen.getByLabelText('Weight in kilograms');
    await user.type(weight, '100');

    // Typing "-" on the way to "-5": the browser reports an empty value, but
    // flags it as unparseable rather than empty.
    Object.defineProperty(weight, 'validity', { value: { badInput: true }, configurable: true });
    fireEvent.change(weight, { target: { value: '' } });

    expect(store().currentWorkout?.steps[0]).toMatchObject({ target: { kg: 100 } });
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

  it('offers a retry or a discard while edits cannot be saved', async () => {
    const storage = await import('../storage/workouts.ts');
    const user = await openEditor();
    const id = store().currentWorkout!.id;
    const failWrites = () =>
      vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));

    let put = failWrites();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.click(screen.getByRole('button', { name: '← Back to library' }));
    // Still here, and told why.
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full');
    expect(screen.getByLabelText('Exercise')).toBeInTheDocument();

    put.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect((await storage.getWorkout(id))?.steps).toHaveLength(1);

    // When saving is not coming back, a way out that does not need it.
    put = failWrites();
    try {
      await user.click(screen.getByRole('button', { name: '+ Rest' }));
      await store().flushSteps();
      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
      expect(store().currentWorkout).toBeNull();
    } finally {
      put.mockRestore();
    }
    expect((await storage.getWorkout(id))?.steps).toHaveLength(1);
  });

  it('writes pending edits when the workout is closed', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.type(screen.getByLabelText('Exercise'), 'Row');

    const id = store().currentWorkout!.id;
    await user.click(screen.getByRole('button', { name: '← Back to library' }));

    // Closing waits for the write, so it is there the moment the editor goes,
    // well inside the autosave pause.
    await waitFor(() => expect(store().currentWorkout).toBeNull());
    const { getWorkout } = await import('../storage/workouts.ts');
    expect((await getWorkout(id))?.steps).toMatchObject([{ exercise: 'Row' }]);
  });
});
