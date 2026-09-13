import { describe, expect, it } from 'vitest';
import type { ExerciseStep, RepeatBlock, RestStep, WorkoutStep } from './workout.js';
import {
  cloneStep,
  duplicateStep,
  getStep,
  insertStep,
  isDescendant,
  moveStep,
  moveStepBy,
  pathAfter,
  pruneEmptyBlocks,
  removeStep,
  replaceStep,
} from './steps.js';

function exercise(name: string): ExerciseStep {
  return {
    kind: 'exercise',
    category: 'UNKNOWN',
    exercise: name,
    duration: { type: 'reps', reps: 5 },
  };
}

const rest: RestStep = { kind: 'rest', duration: { type: 'time', seconds: 60 } };

function repeat(rounds: number, ...steps: WorkoutStep[]): RepeatBlock {
  return { kind: 'repeat', rounds, steps };
}

/** [ A, 3×[ B, rest ], C ] — one nesting level, enough for every index case. */
function tree(): WorkoutStep[] {
  return [exercise('A'), repeat(3, exercise('B'), rest), exercise('C')];
}

const nameAt = (steps: WorkoutStep[], path: number[]): string | undefined => {
  const step = getStep(steps, path);
  return step?.kind === 'exercise' ? step.exercise : step?.kind;
};

describe('getStep', () => {
  it('walks into repeat blocks', () => {
    expect(nameAt(tree(), [0])).toBe('A');
    expect(nameAt(tree(), [1])).toBe('repeat');
    expect(nameAt(tree(), [1, 0])).toBe('B');
    expect(nameAt(tree(), [1, 1])).toBe('rest');
  });

  it('returns undefined for a path that does not resolve', () => {
    expect(getStep(tree(), [])).toBeUndefined();
    expect(getStep(tree(), [9])).toBeUndefined();
    // Into a step that has no children.
    expect(getStep(tree(), [0, 0])).toBeUndefined();
  });
});

describe('replaceStep', () => {
  it('replaces a nested step and leaves the other branches identical', () => {
    const before = tree();
    const after = replaceStep(before, [1, 0], exercise('Z'));

    expect(nameAt(after, [1, 0])).toBe('Z');
    expect(nameAt(before, [1, 0])).toBe('B');
    // Untouched branches are shared, not rebuilt.
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[2]);
  });

  it('ignores a path that no longer resolves', () => {
    const before = tree();
    expect(replaceStep(before, [9], exercise('Z'))).toBe(before);
    expect(replaceStep(before, [0, 0], exercise('Z'))).toBe(before);
  });
});

describe('insertStep', () => {
  it('inserts at the given index, including one past the end', () => {
    expect(nameAt(insertStep(tree(), [0], exercise('Z')), [0])).toBe('Z');
    expect(nameAt(insertStep(tree(), [3], exercise('Z')), [3])).toBe('Z');
    expect(insertStep(tree(), [4], exercise('Z'))).toHaveLength(3);
  });

  it('inserts inside a repeat block', () => {
    const after = insertStep(tree(), [1, 1], exercise('Z'));
    expect(nameAt(after, [1, 1])).toBe('Z');
    expect(nameAt(after, [1, 2])).toBe('rest');
  });
});

describe('removeStep', () => {
  it('removes a top-level step', () => {
    const after = removeStep(tree(), [0]);
    expect(after.map((s) => s.kind)).toEqual(['repeat', 'exercise']);
  });

  it('takes the block with the last step removed from it', () => {
    const after = removeStep(removeStep(tree(), [1, 1]), [1, 0]);
    // The block is gone rather than left empty, which cannot be stored.
    expect(after.map((s) => s.kind)).toEqual(['exercise', 'exercise']);
  });

  it('prunes emptied blocks all the way up', () => {
    const nested = [repeat(2, repeat(3, exercise('only')))];
    expect(removeStep(nested, [0, 0, 0])).toEqual([]);
  });
});

describe('moveStep', () => {
  it('moves a step down, counting the destination before the move', () => {
    // Dropping A at index 2 means "above C".
    const after = moveStep(tree(), [0], [2]);
    expect(after.map((s) => (s.kind === 'exercise' ? s.exercise : s.kind))).toEqual([
      'repeat',
      'A',
      'C',
    ]);
  });

  it('moves a step up', () => {
    const after = moveStep(tree(), [2], [0]);
    expect(nameAt(after, [0])).toBe('C');
  });

  it('is a no-op when the step would land where it already is', () => {
    const before = tree();
    expect(moveStep(before, [0], [0])).toBe(before);
    // Index 1 is the gap immediately below A: still above the repeat block.
    expect(moveStep(before, [0], [1])).toEqual(before);
  });

  it('moves a step into a block', () => {
    const after = moveStep(tree(), [2], [1, 0]);
    expect(nameAt(after, [1, 0])).toBe('C');
    expect(after).toHaveLength(2);
  });

  it('moves a block into a later position, adjusting for its own removal', () => {
    const after = moveStep(tree(), [1], [3]);
    expect(after.map((s) => s.kind)).toEqual(['exercise', 'exercise', 'repeat']);
  });

  it('moves the last step out of a block and prunes the block', () => {
    const single = [repeat(3, exercise('only')), exercise('after')];
    const after = moveStep(single, [0, 0], [2]);
    expect(after.map((s) => (s.kind === 'exercise' ? s.exercise : s.kind))).toEqual([
      'after',
      'only',
    ]);
  });

  it('refuses to move a block inside itself', () => {
    const before = tree();
    expect(moveStep(before, [1], [1, 0])).toBe(before);
  });
});

describe('moveStepBy', () => {
  it('swaps with the neighbouring sibling', () => {
    expect(nameAt(moveStepBy(tree(), [0], 1), [1])).toBe('A');
    expect(nameAt(moveStepBy(tree(), [2], -1), [1])).toBe('C');
  });

  it('stays put at either end, and inside a block', () => {
    const before = tree();
    expect(moveStepBy(before, [0], -1)).toBe(before);
    expect(moveStepBy(before, [2], 1)).toBe(before);
    // A block's first child does not escape into the list above.
    expect(moveStepBy(before, [1, 0], -1)).toBe(before);
    expect(nameAt(moveStepBy(before, [1, 0], 1), [1, 1])).toBe('B');
  });
});

describe('duplicateStep', () => {
  it('inserts the copy directly below the original', () => {
    const after = duplicateStep(tree(), [0]);
    expect(after.map((s) => (s.kind === 'exercise' ? s.exercise : s.kind))).toEqual([
      'A',
      'A',
      'repeat',
      'C',
    ]);
  });

  it('deep-copies a block, so editing the copy leaves the original alone', () => {
    const after = duplicateStep(tree(), [1]);
    const copy = getStep(after, [2]);
    const original = getStep(after, [1]);
    expect(copy).toEqual(original);
    expect(copy).not.toBe(original);
    expect(getStep(after, [2, 0])).not.toBe(getStep(after, [1, 0]));

    const edited = replaceStep(after, [2, 0], exercise('changed'));
    expect(nameAt(edited, [1, 0])).toBe('B');
  });
});

describe('helpers', () => {
  it('pathAfter steps to the next index in the same list', () => {
    expect(pathAfter([1, 0])).toEqual([1, 1]);
    expect(pathAfter([])).toEqual([]);
  });

  it('isDescendant only counts paths inside the ancestor', () => {
    expect(isDescendant([1, 0], [1])).toBe(true);
    expect(isDescendant([1], [1])).toBe(false);
    expect(isDescendant([2, 0], [1])).toBe(false);
  });

  it('pruneEmptyBlocks returns the same array when nothing is empty', () => {
    const before = tree();
    expect(pruneEmptyBlocks(before)).toBe(before);
  });

  it('cloneStep copies nested steps', () => {
    const block = repeat(2, exercise('x'));
    const copy = cloneStep(block);
    expect(copy).toEqual(block);
    expect(copy).not.toBe(block);
  });
});
