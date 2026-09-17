import { describe, expect, it } from 'vitest';
import { newWorkout } from './workouts.ts';
import { clearUnsaved, stashUnsaved, unsavedCopies } from './unsaved.ts';

/** Writes a copy of the same workout as another tab would, over this tab's key. */
function copyFromAnotherTab(id: string, baseSeq: number) {
  localStorage.setItem(
    `workout-editor:unsaved:${id}`,
    JSON.stringify({ baseSeq, version: crypto.randomUUID(), workout: { id } }),
  );
}

describe('unsaved copies', () => {
  it('removes only the copy it was told to, by the edit it holds', () => {
    const workout = newWorkout('Push Day');
    const version = stashUnsaved(workout, 1);
    expect(unsavedCopies()).toHaveLength(1);

    // Another tab's edit of the same workout takes over the copy...
    copyFromAnotherTab(workout.id, 1);
    // ...and this tab writing its own edit must not take that copy with it.
    clearUnsaved(workout.id, version);
    expect(unsavedCopies()).toHaveLength(1);

    // Its own copy, though, it does clear.
    const mine = stashUnsaved(workout, 1);
    clearUnsaved(workout.id, mine);
    expect(unsavedCopies()).toEqual([]);
  });

  it('never gives two copies the same version, in this tab or another', () => {
    const workout = newWorkout('Push Day');
    // A counter would hand the same numbers to every tab that starts fresh.
    expect(stashUnsaved(workout, 1)).not.toBe(stashUnsaved(workout, 1));
  });

  it('clears unconditionally when given no version, for a discard', () => {
    const workout = newWorkout('Push Day');
    stashUnsaved(workout, 1);
    clearUnsaved(workout.id);
    expect(unsavedCopies()).toEqual([]);
  });
});
