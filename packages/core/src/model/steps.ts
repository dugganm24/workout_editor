import type { WorkoutStep } from './workout.js';

/**
 * Pure operations on the step tree. The editor, keyboard reordering and drag
 * all move steps around the same nested structure, so the index arithmetic
 * lives here — testable without a browser — rather than three times over in
 * component handlers.
 *
 * Every function returns a new tree and shares the subtrees it did not touch.
 */

/**
 * A step's position: indices from the root, one per level of nesting. `[2]` is
 * the third top-level step; `[2, 0]` is the first step inside it. The empty
 * path addresses the root list itself, which is not a step.
 */
export type StepPath = readonly number[];

export function pathsEqual(a: StepPath, b: StepPath): boolean {
  return a.length === b.length && a.every((index, level) => index === b[level]);
}

/** True when `path` is inside `ancestor` — a block cannot be moved into itself. */
export function isDescendant(path: StepPath, ancestor: StepPath): boolean {
  return path.length > ancestor.length && ancestor.every((index, level) => index === path[level]);
}

function childrenOf(step: WorkoutStep | undefined): WorkoutStep[] | undefined {
  return step?.kind === 'repeat' ? step.steps : undefined;
}

export function getStep(steps: WorkoutStep[], path: StepPath): WorkoutStep | undefined {
  let current: WorkoutStep | undefined;
  let list: WorkoutStep[] | undefined = steps;
  for (const index of path) {
    current = list?.[index];
    list = childrenOf(current);
  }
  return path.length > 0 ? current : undefined;
}

/**
 * Rewrites the list that holds `path`'s last index, leaving every other branch
 * untouched. Returns the tree unchanged if the path does not resolve — callers
 * are UI handlers, and a stale path from a step that has since moved must not
 * corrupt the tree.
 */
function editParent(
  steps: WorkoutStep[],
  path: StepPath,
  edit: (siblings: WorkoutStep[], index: number) => WorkoutStep[],
): WorkoutStep[] {
  if (path.length === 0) return steps;
  const [index, ...rest] = path as number[];
  if (index === undefined || index < 0) return steps;

  if (rest.length === 0) return edit(steps, index);

  const parent = steps[index];
  if (parent?.kind !== 'repeat') return steps;
  const edited = editParent(parent.steps, rest, edit);
  if (edited === parent.steps) return steps;

  const next = [...steps];
  next[index] = { ...parent, steps: edited };
  return next;
}

export function replaceStep(
  steps: WorkoutStep[],
  path: StepPath,
  next: WorkoutStep,
): WorkoutStep[] {
  return editParent(steps, path, (siblings, index) => {
    if (!siblings[index]) return siblings;
    const copy = [...siblings];
    copy[index] = next;
    return copy;
  });
}

/**
 * Inserts so the new step lands *at* `path` — the index it will occupy, which
 * may be one past the end of its list, the position "append" means.
 */
export function insertStep(steps: WorkoutStep[], path: StepPath, step: WorkoutStep): WorkoutStep[] {
  return editParent(steps, path, (siblings, index) => {
    if (index > siblings.length) return siblings;
    const copy = [...siblings];
    copy.splice(index, 0, step);
    return copy;
  });
}

/**
 * A repeat block with no steps left cannot be stored — `RepeatBlockSchema`
 * requires at least one — and an empty block is not something a user means to
 * keep. Emptying one by deleting or dragging out its last step therefore takes
 * the block with it, all the way up if that empties its parent too.
 */
export function pruneEmptyBlocks(steps: WorkoutStep[]): WorkoutStep[] {
  let changed = false;
  const pruned: WorkoutStep[] = [];
  for (const step of steps) {
    if (step.kind !== 'repeat') {
      pruned.push(step);
      continue;
    }
    const children = pruneEmptyBlocks(step.steps);
    changed ||= children !== step.steps;
    if (children.length === 0) {
      changed = true;
      continue;
    }
    pruned.push(children === step.steps ? step : { ...step, steps: children });
  }
  return changed ? pruned : steps;
}

export function removeStep(steps: WorkoutStep[], path: StepPath): WorkoutStep[] {
  const without = editParent(steps, path, (siblings, index) => {
    if (!siblings[index]) return siblings;
    const copy = [...siblings];
    copy.splice(index, 1);
    return copy;
  });
  return pruneEmptyBlocks(without);
}

/**
 * Moves the step at `from` so it lands at `to`, where `to` is read against the
 * tree *before* the move: dropping between two visible rows means the index of
 * the row you dropped above, whichever direction the step travelled from.
 *
 * Pruning runs last, once the indices `to` was measured against no longer
 * matter, so emptying a block by dragging its final step out cannot shift the
 * destination out from under the insert.
 */
export function moveStep(steps: WorkoutStep[], from: StepPath, to: StepPath): WorkoutStep[] {
  const step = getStep(steps, from);
  if (!step || from.length === 0 || to.length === 0) return steps;
  // Into its own subtree there is no coherent answer, and the step would take
  // the tree it is being inserted into with it.
  if (isDescendant(to, from)) return steps;
  // The gap directly above or below a step is where it already is. Handing
  // back the same tree is what tells the caller nothing changed, so a drop in
  // place is not saved as an edit.
  const destination = shiftForRemoval(from, to);
  if (pathsEqual(destination, from)) return steps;

  const detached = editParent(steps, from, (siblings, index) => {
    if (!siblings[index]) return siblings;
    const copy = [...siblings];
    copy.splice(index, 1);
    return copy;
  });
  if (detached === steps) return steps;

  return pruneEmptyBlocks(insertStep(detached, destination, step));
}

/**
 * `to` was measured before the step was detached. Removing it shifts every
 * later index in *its own* list down by one, including an ancestor of the
 * destination — a step moving out of a block that sits above the target moves
 * the target up with it.
 */
function shiftForRemoval(from: StepPath, to: StepPath): StepPath {
  const level = from.length - 1;
  if (to.length < from.length) return to;
  const sameList = from.every((index, depth) => depth === level || index === to[depth]);
  const target = to[level];
  if (!sameList || target === undefined || target <= (from[level] ?? 0)) return to;
  const shifted = [...to];
  shifted[level] = target - 1;
  return shifted;
}

/**
 * Swaps a step with the sibling above or below it, the keyboard's idea of
 * reordering. Kept apart from `moveStep` because the two count differently:
 * this one is a swap between two known rows, where "down" is unambiguous,
 * while a drag names a gap measured before anything moved.
 */
export function moveStepBy(steps: WorkoutStep[], path: StepPath, delta: number): WorkoutStep[] {
  if (path.length === 0 || delta === 0) return steps;
  const from = path[path.length - 1] ?? 0;
  return editParent(steps, path, (siblings, index) => {
    const target = from + delta;
    const step = siblings[index];
    const other = siblings[target];
    // At either end there is nothing to swap with, so the step stays put.
    if (!step || !other) return siblings;
    const copy = [...siblings];
    copy[index] = other;
    copy[target] = step;
    return copy;
  });
}

/** The position one after `path`, in the same list: where "add below" goes. */
export function pathAfter(path: StepPath): StepPath {
  if (path.length === 0) return path;
  const next = [...path];
  next[next.length - 1] = (next[next.length - 1] ?? 0) + 1;
  return next;
}

/**
 * A deep copy under no shared references, so editing the copy leaves the
 * original alone — its `duration` and `target` included, not just the step.
 * Steps are plain JSON by schema (backups round-trip them that way), so a JSON
 * round trip copies every level, including fields added after this was written.
 */
export function cloneStep(step: WorkoutStep): WorkoutStep {
  return JSON.parse(JSON.stringify(step)) as WorkoutStep;
}

export function duplicateStep(steps: WorkoutStep[], path: StepPath): WorkoutStep[] {
  const step = getStep(steps, path);
  if (!step) return steps;
  return insertStep(steps, pathAfter(path), cloneStep(step));
}
