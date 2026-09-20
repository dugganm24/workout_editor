import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

/** The picker's open list of matches; the duration select has options of its own. */
const suggestions = () => within(screen.getByRole('listbox')).getAllByRole('option');

/** The drop zones a drag shows at the end of every list. */
const tailZones = () => document.querySelectorAll('li.border-dashed');

/** jsdom implements no DataTransfer, which the handler fills in for Firefox. */
const beginDrag = (handle: Element) =>
  fireEvent.dragStart(handle, {
    dataTransfer: { effectAllowed: 'none', setData: () => undefined },
  });

/** Starts a drag; the drop zones appear once `dragstart` has returned, as in a browser. */
async function startDrag(handle: Element) {
  beginDrag(handle);
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

  it('lets a name be typed with spaces, and stores it without the ones around it', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    const name = screen.getByLabelText('Exercise');

    // The space before a word is typed like any other character...
    await user.type(name, ' Back Squat ');
    expect(name).toHaveValue(' Back Squat ');
    // ...but the model has no name made only of spaces, and keeps none around it.
    expect(store().currentWorkout?.steps[0]).toMatchObject({ exercise: 'Back Squat' });

    await user.tab();
    expect(name).toHaveValue('Back Squat');
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

    await user.click(screen.getByRole('button', { name: 'Move rest 2 up' }));

    expect(store().currentWorkout?.steps).toMatchObject([{ kind: 'rest' }, { kind: 'exercise' }]);
    expect(screen.getByRole('button', { name: 'Move rest 1 up' })).toHaveFocus();

    // And a copy of it, which has no number box either, still takes the cursor.
    await user.click(screen.getByRole('button', { name: 'Duplicate rest 1' }));
    expect(screen.getAllByLabelText('Duration type')[1]).toHaveFocus();
  });

  it('leaves Alt+arrow on a select to the select, which is how it opens', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.click(screen.getByRole('button', { name: '+ Rest' }));

    screen.getAllByLabelText('Duration type')[1]!.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(store().currentWorkout?.steps.map((s) => s.kind)).toEqual(['exercise', 'rest']);
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
    beginDrag(screen.getAllByText('⠿').at(-1)!);
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

  it('shows an imported step by its Garmin display names', async () => {
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

    expect(exerciseNames()).toEqual(['Plank', 'Barbell Bench Press']);
    expect(screen.getByRole('button', { name: 'Delete Plank' })).toBeInTheDocument();
    expect(screen.getByText('Keep hips level')).toBeInTheDocument();

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Barbell Bench Press' })).toBeInTheDocument();
  });

  it('picks an exercise from the taxonomy by keyboard, and leads with it next time', async () => {
    localStorage.removeItem('workout-editor:recent-exercises');
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    const box = screen.getByLabelText('Exercise');

    await user.type(box, 'barbell bench');
    expect(suggestions()[0]).toHaveTextContent('Barbell Bench Press');
    // Typed text is a name of its own until a match is taken.
    expect(store().currentWorkout?.steps[0]).toMatchObject({
      category: 'UNKNOWN',
      exercise: 'barbell bench',
    });

    await user.keyboard('{ArrowDown}{Enter}');
    expect(store().currentWorkout?.steps[0]).toMatchObject({
      category: 'BENCH_PRESS',
      exercise: 'BARBELL_BENCH_PRESS',
    });
    // That Enter took the match; it did not also add a step.
    expect(exerciseNames()).toEqual(['Barbell Bench Press']);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // A second Enter adds the next step, whose empty box leads with the recent pick.
    await user.keyboard('{Enter}');
    expect(screen.getAllByLabelText('Exercise')[1]).toHaveFocus();
    expect(suggestions()[0]).toHaveTextContent('Barbell Bench Press');

    // Typing over a pick makes it free text again, under no category.
    await user.click(suggestions()[0]!);
    await user.type(screen.getAllByLabelText('Exercise')[1]!, 'x');
    expect(store().currentWorkout?.steps[1]).toMatchObject({
      category: 'UNKNOWN',
      exercise: 'Barbell Bench Pressx',
    });
  });

  it('shows no category for a step the editor added itself', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    // Named by where it is, so a second unnamed row would not share the name.
    expect(screen.getByRole('button', { name: 'Delete exercise 1' })).toBeInTheDocument();
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
    store().editSteps(() => [exercise('A'), exercise('B'), exercise('C')]);
    render(<OpenWorkout />);

    await startDrag(screen.getAllByText('⠿')[0]!);
    const b = screen.getAllByLabelText('Exercise')[2]!.closest('li')!;
    fireEvent.dragOver(b);
    const [nameBox, repsBox] = [
      screen.getAllByLabelText('Exercise')[2]!,
      screen.getAllByLabelText('Reps')[2]!,
    ];
    // jsdom has no DragEvent, and only a MouseEvent carries `relatedTarget`.
    const leave = (from: Element, to: Element | null) =>
      act(() => {
        from.dispatchEvent(new MouseEvent('dragleave', { bubbles: true, relatedTarget: to }));
      });
    leave(nameBox, repsBox);
    expect(b).toHaveClass('border-gray-900');

    // Safari reports no relatedTarget at all, so a missing one cannot mean
    // "left the tree"; the end of the drag clears it instead.
    leave(b, null);
    expect(b).toHaveClass('border-gray-900');

    leave(b, document.body);
    expect(b).not.toHaveClass('border-gray-900');

    fireEvent.dragOver(b);
    expect(b).toHaveClass('border-gray-900');
    fireEvent.dragEnd(screen.getAllByText('⠿')[0]!);
    expect(b).not.toHaveClass('border-gray-900');
  });

  it('offers no drop on the gaps a step is already in', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [exercise('A'), exercise('B')]);
    render(<OpenWorkout />);

    await startDrag(screen.getAllByText('⠿')[0]!);
    const rows = screen.getAllByLabelText('Exercise').map((box) => box.closest('li')!);

    // Above A is where A is, and so is above B: dropping there moves nothing,
    // so neither is highlighted or accepts the drop.
    fireEvent.dragOver(rows[0]!);
    expect(rows[0]).not.toHaveClass('border-gray-900');
    fireEvent.dragOver(rows[1]!);
    expect(rows[1]).not.toHaveClass('border-gray-900');

    // The end of the list is below B, which does move it.
    const tail = tailZones()[0]!;
    fireEvent.dragOver(tail);
    fireEvent.drop(tail);
    expect(exerciseNames()).toEqual(['B', 'A']);
  });

  it('renders each list as list items only', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [exercise('A'), { kind: 'repeat', rounds: 3, steps: [exercise('B')] }]);
    render(<OpenWorkout />);

    expect(document.querySelectorAll('ol > :not(li)')).toHaveLength(0);
  });

  it('asks before a block delete takes its steps with it', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Repeat block' }));
    await user.type(screen.getByLabelText('Exercise'), 'Squat');
    await user.click(screen.getAllByRole('button', { name: '+ Rest' })[0]!);

    // Nothing in this app can be undone, so the first click only arms it.
    await user.click(screen.getByRole('button', { name: 'Delete repeat block 1' }));
    expect(store().currentWorkout?.steps).toHaveLength(1);
    const confirm = screen.getByRole('button', {
      name: 'Confirm deleting repeat block 1 and its 2 steps',
    });

    // Away from the button, and it is no longer the click being made.
    await user.click(screen.getByLabelText('Rounds'));
    expect(screen.getByRole('button', { name: 'Delete repeat block 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete repeat block 1' }));
    await user.click(confirm);
    expect(store().currentWorkout?.steps).toEqual([]);
  });

  it('deletes a step that takes nothing with it in one click', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));

    await user.click(screen.getByRole('button', { name: 'Delete exercise 1' }));

    expect(store().currentWorkout?.steps).toEqual([]);
  });

  it('gives rows that have no name of their own a name each', async () => {
    const user = await openEditor();
    await user.click(screen.getByRole('button', { name: '+ Exercise' }));
    await user.keyboard('{Enter}');
    await user.click(screen.getAllByRole('button', { name: '+ Rest' }).at(-1)!);

    // Three unnamed rows, three distinct buttons to act on them.
    expect(
      screen
        .getAllByRole('button', { name: /^Delete/ })
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Delete exercise 1', 'Delete exercise 2', 'Delete rest 3']);
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

  it('never writes a number into the step that replaced the one being edited', async () => {
    await store().createWorkout('Push Day');
    store().editSteps(() => [
      { ...exercise('A'), duration: { type: 'reps', reps: 8 } },
      { ...exercise('B'), duration: { type: 'reps', reps: 10 } },
    ]);
    render(<OpenWorkout />);
    const user = userEvent.setup();

    const reps = screen.getAllByLabelText('Reps')[0]!;
    await user.click(reps);
    await user.clear(reps);
    await user.type(reps, '10');
    // Emptied again, so leaving the box would put A's original 8 back — but
    // the row is about to hold B, whose reps happen to be 10 as well.
    await user.clear(reps);
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(
      store().currentWorkout?.steps.map((step) => [
        step.kind === 'exercise' ? step.exercise : step.kind,
        step.kind === 'exercise' && step.duration.type === 'reps' ? step.duration.reps : null,
      ]),
    ).toEqual([
      ['B', 10],
      ['A', 10],
    ]);
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

    await user.click(screen.getByRole('button', { name: 'Delete rest 2' }));
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
    const put = vi.spyOn(storage, 'putWorkout');
    try {
      put.mockRejectedValue(new Error('disk full'));
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
      vi.spyOn(storage, 'putWorkout').mockRejectedValue(new Error('disk full'));
      await user.click(screen.getByRole('button', { name: '+ Rest' }));
      await store().flushSteps();
      await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
      expect(store().currentWorkout).toBeNull();
    } finally {
      vi.restoreAllMocks();
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
