import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  countLeafSteps,
  displayName,
  duplicateStep,
  getStep,
  insertStep,
  isDescendant,
  KilogramsSchema,
  moveStep,
  moveStepBy,
  pathAfter,
  movesNowhere,
  pathsEqual,
  removeStep,
  replaceStep,
  RepsSchema,
  RoundsSchema,
  SecondsSchema,
  type ExerciseStep,
  type RepeatBlock,
  type RestStep,
  type StepPath,
  type WorkoutStep,
} from '@workout-editor/core';
import {
  DEFAULT_REPS,
  DEFAULT_SECONDS,
  newExerciseStep,
  newRepeatBlock,
  newRestStep,
  PLACEHOLDER_CATEGORY,
  stepLike,
} from './stepDefaults.ts';
import ExercisePicker from './ExercisePicker.tsx';

/**
 * The editable step tree. Rows mirror the canonical model one-for-one — an
 * exercise, a rest, or a repeat block holding more of the same — and every
 * change goes straight into the store, which writes it in the background.
 *
 * The whole surface is reachable from the keyboard: Enter adds the next step
 * of the same kind and lands the cursor in it, Alt+↑/↓ reorders without ever
 * touching the mouse, and every action a row offers is a real button in tab
 * order. Dragging is the alternative, not the requirement.
 */

type Edit = (steps: WorkoutStep[]) => WorkoutStep[];

/**
 * Where the cursor goes once the tree re-renders. `control` is the position of
 * a control among the row's own (see `ownControls`): a moved row keeps focus on
 * whichever control moved it. Without one, the row's first field takes it, as
 * a freshly added row should.
 */
interface FocusRequest {
  path: StepPath;
  control?: number;
}

interface EditorApi {
  /**
   * Applies an edit. False when it changed nothing, so there is nothing to
   * follow with the cursor. `moves` says the edit can put a different step at
   * a position a row already occupies (see `generation`).
   */
  edit: (mutate: Edit, options?: { moves: boolean }) => boolean;
  /**
   * Bumped by every edit that moves steps. Rows are addressed by position, so
   * it goes in their keys: a row whose step changed underneath it is a new row,
   * and no state of the old one — a half-typed number, a pending blur — can be
   * written into the step that replaced it.
   */
  generation: number;
  /** The row that should take the cursor once it renders, then be forgotten. */
  focusRequest: FocusRequest | null;
  requestFocus: (path: StepPath | null, control?: number) => void;
  dragPath: StepPath | null;
  setDragPath: (path: StepPath | null) => void;
  dropPath: StepPath | null;
  setDropPath: (path: StepPath | null) => void;
}

const EditorContext = createContext<EditorApi | null>(null);

function useEditor(): EditorApi {
  const api = useContext(EditorContext);
  if (!api) throw new Error('StepEditor components must be rendered inside StepEditor');
  return api;
}

/**
 * Provides the editing context and owns what only the tree as a whole knows:
 * which row wants the cursor, and what is being dragged where.
 */
export function StepEditorProvider({
  edit,
  children,
}: {
  edit: (mutate: Edit) => void;
  children: React.ReactNode;
}) {
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [generation, setGeneration] = useState(0);
  const [dragPath, setDragPath] = useState<StepPath | null>(null);
  const [dropPath, setDropPathState] = useState<StepPath | null>(null);

  // `dragover` fires every few milliseconds, and each handler builds a fresh
  // path array. Handing the same position back as the previous state lets
  // React skip the render; a new array every time re-rendered every row.
  const setDropPath = useCallback(
    (path: StepPath | null) =>
      setDropPathState((current) =>
        current === path || (current && path && pathsEqual(current, path)) ? current : path,
      ),
    [],
  );

  // A request only ever names a row the edit just produced. One made for an
  // edit that changed nothing (moving the first row up) names a row that may
  // not exist, and would sit there until some later edit created it and it
  // stole the cursor; `edit` reporting "no change" is what prevents that.
  const applyEdit = useCallback(
    (mutate: Edit, options?: { moves: boolean }): boolean => {
      let changed = false;
      edit((steps) => {
        const next = mutate(steps);
        changed = next !== steps;
        return next;
      });
      if (changed && options?.moves) setGeneration((current) => current + 1);
      return changed;
    },
    [edit],
  );

  const requestFocus = useCallback(
    (path: StepPath | null, control?: number) =>
      setFocusRequest(path === null ? null : { path, control }),
    [],
  );

  // Stable between changes to its own state, so the rows only re-render for
  // the tree's state and not every time the editor above them does.
  const api = useMemo(
    () => ({
      edit: applyEdit,
      generation,
      focusRequest,
      requestFocus,
      dragPath,
      setDragPath,
      dropPath,
      setDropPath,
    }),
    [applyEdit, generation, focusRequest, requestFocus, dragPath, dropPath, setDropPath],
  );

  return <EditorContext.Provider value={api}>{children}</EditorContext.Provider>;
}

/** Structural, so the editor needs the model's schemas but not zod itself. */
interface NumberRule {
  safeParse: (value: unknown) => { success: boolean };
}

/**
 * A number the model insists on, checked against the model's own schema for
 * that field. Each value the rule accepts is committed as it is typed, so an
 * autosave or an Enter that adds the next step never loses it. Text the rule
 * rejects ("", "0", "7.5" reps) stays in a draft, marked invalid, and never
 * reaches the store, where it would fail validation on save.
 *
 * Leaving the box with a rejected draft puts back the value it had when focus
 * arrived. Otherwise backing "12" out to "1" and then "", and tabbing away,
 * would keep the 1 the user only passed through on the way.
 */
function NumberField({
  label,
  value,
  suffix,
  rule,
  integer = false,
  optional = false,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  suffix?: string;
  rule: NumberRule;
  /** Only shapes the spinner and arrow-key steps; `rule` decides what is kept. */
  integer?: boolean;
  /** Clearing the box removes the value rather than being rejected. */
  optional?: boolean;
  onCommit: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  /** The value when focus arrived, to put back if what replaced it is rejected. */
  const original = useRef<number | undefined>(undefined);
  const focused = useRef(false);
  const invalid = draft !== null && !accepts(draft);

  function accepts(text: string): boolean {
    return text.trim() === '' ? optional : rule.safeParse(Number(text)).success;
  }

  function change(input: HTMLInputElement) {
    const text = input.value;
    setDraft(text);
    // A number box reports "" for text it cannot parse yet ("-", ".", "1e") as
    // well as for an empty one. Only a truly empty box counts as cleared.
    if (input.validity.badInput) return;
    if (text.trim() === '') {
      if (optional) onCommit(undefined);
      return;
    }
    const parsed = Number(text);
    if (rule.safeParse(parsed).success) onCommit(parsed);
  }

  function blur(input: HTMLInputElement) {
    const wasFocused = focused.current;
    focused.current = false;
    setDraft(null);
    if (!wasFocused) return;
    const rejected = input.validity.badInput || (draft !== null && !accepts(draft));
    if (rejected && original.current !== value) onCommit(original.current);
  }

  return (
    <label className="flex items-baseline gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        min={integer ? 1 : 0}
        step={integer ? 1 : 'any'}
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={`w-16 rounded-md border px-2 py-1 text-sm focus:outline-none ${
          invalid ? 'border-red-500 focus:border-red-600' : 'border-gray-300 focus:border-gray-500'
        }`}
        value={draft ?? (value === undefined ? '' : String(value))}
        onFocus={() => {
          original.current = value;
          focused.current = true;
        }}
        onChange={(event) => change(event.target)}
        onBlur={(event) => blur(event.target)}
      />
      {suffix && <span className="text-gray-500">{suffix}</span>}
    </label>
  );
}

/** Reps / time / open — the three ways a step can end. */
function DurationFields({ step, path }: { step: ExerciseStep | RestStep; path: StepPath }) {
  const { edit } = useEditor();
  const kinds =
    step.kind === 'rest' ? (['time', 'open'] as const) : (['reps', 'time', 'open'] as const);

  function setDuration(next: ExerciseStep['duration']) {
    edit((steps) => replaceStep(steps, path, { ...step, duration: next } as WorkoutStep));
  }

  return (
    <>
      <label className="text-sm">
        <span className="sr-only">Duration type</span>
        <select
          aria-label="Duration type"
          className="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
          value={step.duration.type}
          onChange={(event) => {
            const type = event.target.value;
            if (type === 'reps') setDuration({ type: 'reps', reps: DEFAULT_REPS });
            if (type === 'time') setDuration({ type: 'time', seconds: DEFAULT_SECONDS });
            if (type === 'open') setDuration({ type: 'open' });
          }}
        >
          {kinds.map((kind) => (
            <option key={kind} value={kind}>
              {kind === 'reps' ? 'reps' : kind === 'time' ? 'time' : 'until lap press'}
            </option>
          ))}
        </select>
      </label>

      {step.duration.type === 'reps' && (
        <NumberField
          label="Reps"
          suffix="reps"
          rule={RepsSchema}
          integer
          value={step.duration.reps}
          onCommit={(reps) => reps !== undefined && setDuration({ type: 'reps', reps })}
        />
      )}
      {step.duration.type === 'time' && (
        <NumberField
          label="Seconds"
          suffix="sec"
          rule={SecondsSchema}
          value={step.duration.seconds}
          onCommit={(seconds) => seconds !== undefined && setDuration({ type: 'time', seconds })}
        />
      )}
    </>
  );
}

/**
 * The controls that belong to a row itself, in DOM order — not those of rows
 * nested inside it. The same step renders the same list wherever it moves to,
 * so a position in it names the same control after a move.
 */
function ownControls(row: Element): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('input, select, button')].filter(
    (control) => control.closest('li') === row,
  );
}

function controlIndex(control: Element): number | undefined {
  const row = control.closest('li');
  const index = row ? ownControls(row).indexOf(control as HTMLElement) : -1;
  return index === -1 ? undefined : index;
}

/**
 * Where the cursor goes after a delete: the step that takes the deleted one's
 * place, else the one before it. A step that was the only one in its block
 * takes the block with it, so the search moves out to the block's own
 * neighbours. Worked out on the tree *before* the delete, since after it a path
 * inside a pruned block can resolve to a step inside the next block instead.
 *
 * Never left on the Delete button: rows are keyed by position, so that button
 * now belongs to the next step, and a second Enter would delete it too. The
 * empty path, when nothing is left, means the add buttons under the tree.
 */
function focusAfterRemoval(before: WorkoutStep[], path: StepPath): StepPath {
  for (let at = path; at.length > 0; at = at.slice(0, -1)) {
    const parent = at.slice(0, -1);
    const block = getStep(before, parent);
    const siblings = block?.kind === 'repeat' ? block.steps : before;
    if (siblings.length > 1) {
      const index = at[at.length - 1] ?? 0;
      return index < siblings.length - 1 ? at : [...parent, index - 1];
    }
  }
  return [];
}

/** Swaps a step with a neighbour, keeping the cursor on the control that asked. */
function useMoveBy(path: StepPath): (delta: number, control: Element) => void {
  const { edit, requestFocus } = useEditor();
  return (delta, control) => {
    if (!edit((steps) => moveStepBy(steps, path, delta), { moves: true })) return;
    const index = path[path.length - 1] ?? 0;
    requestFocus([...path.slice(0, -1), index + delta], controlIndex(control));
  };
}

function RowActions({ step, path, label }: { step: WorkoutStep; path: StepPath; label: string }) {
  const { edit, requestFocus } = useEditor();
  const move = useMoveBy(path);
  // A block holds steps that would go with it, and nothing here can be undone,
  // so its Delete asks first. One click arms it, the next one deletes.
  const [armed, setArmed] = useState(false);
  const nested = step.kind === 'repeat' ? countLeafSteps(step.steps) : 0;

  function remove() {
    let next: StepPath = [];
    const changed = edit(
      (steps) => {
        next = focusAfterRemoval(steps, path);
        return removeStep(steps, path);
      },
      { moves: true },
    );
    if (changed) requestFocus(next);
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label={`Move ${label} up`}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-xs hover:bg-gray-50"
        onClick={(event) => move(-1, event.currentTarget)}
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${label} down`}
        className="rounded-md border border-gray-300 px-1.5 py-1 text-xs hover:bg-gray-50"
        onClick={(event) => move(1, event.currentTarget)}
      >
        ↓
      </button>
      <button
        type="button"
        aria-label={`Duplicate ${label}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
        onClick={() => {
          if (edit((steps) => duplicateStep(steps, path), { moves: true })) {
            requestFocus(pathAfter(path));
          }
        }}
      >
        Duplicate
      </button>
      <button
        type="button"
        aria-label={
          armed
            ? `Confirm deleting ${label} and its ${nested} step${nested === 1 ? '' : 's'}`
            : `Delete ${label}`
        }
        className={`rounded-md border px-2 py-1 text-xs ${
          armed
            ? 'border-red-600 bg-red-600 font-medium text-white'
            : 'border-gray-300 text-red-700 hover:bg-red-50'
        }`}
        onClick={() => {
          if (nested > 0 && !armed) {
            setArmed(true);
            return;
          }
          remove();
        }}
        // Anywhere else, and it is no longer the click the user is making.
        onBlur={() => setArmed(false)}
      >
        {armed ? `Delete ${nested} step${nested === 1 ? '' : 's'}?` : 'Delete'}
      </button>
    </div>
  );
}

/**
 * One row, whatever it holds. Owns the shared row behaviour: the drag handle,
 * the drop target above it, Enter to add the next step of the same kind, and
 * Alt+↑/↓ to reorder.
 */
function StepRow({
  step,
  path,
  label,
  children,
}: {
  step: WorkoutStep;
  path: StepPath;
  label: string;
  children: React.ReactNode;
}) {
  const { edit, focusRequest, requestFocus, dragPath, setDragPath, dropPath, setDropPath } =
    useEditor();
  const move = useMoveBy(path);
  const dragStartTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isDropTarget = dropPath !== null && pathsEqual(dropPath, path);

  const rowRef = useRef<HTMLLIElement>(null);
  const focusHere = focusRequest && pathsEqual(focusRequest.path, path) ? focusRequest : null;

  // Focus follows the model: whichever row asked for the cursor takes it once.
  useEffect(() => {
    if (!focusHere || !rowRef.current) return;
    const controls = ownControls(rowRef.current);
    if (focusHere.control !== undefined) {
      // A moved row: the control that moved it keeps the cursor, and its text
      // stays as it was, so the next keystroke does not overwrite a field.
      controls[focusHere.control]?.focus();
    } else {
      // A new row: its first box, ready to type over. A rest that ends on a
      // lap press has only its select, and must still take the cursor.
      const field =
        controls.find((control) => control instanceof HTMLInputElement) ??
        controls.find((control) => control instanceof HTMLSelectElement);
      field?.focus();
      if (field instanceof HTMLInputElement) field.select();
    }
    requestFocus(null);
  }, [focusHere, requestFocus]);

  function keyDown(event: React.KeyboardEvent<HTMLLIElement>) {
    // Only keys pressed on this row's own controls. A block's row contains its
    // nested rows and its own add buttons, whose keys bubble up through it.
    const target = event.target as Element;
    if (target.closest('li') !== event.currentTarget) return;

    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      // The Enter that confirms an IME candidate belongs to the composition.
      !event.nativeEvent.isComposing &&
      // Enter on a button or select is that control's own action.
      target instanceof HTMLInputElement
    ) {
      event.preventDefault();
      const next = pathAfter(path);
      if (edit((steps) => insertStep(steps, next, stepLike(step)), { moves: true })) {
        requestFocus(next);
      }
      return;
    }
    if (
      event.altKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      // Alt+↓ is how a keyboard opens a select; the row does not take that away.
      !(target instanceof HTMLSelectElement)
    ) {
      event.preventDefault();
      move(event.key === 'ArrowUp' ? -1 : 1, target);
    }
  }

  return (
    <li
      ref={rowRef}
      className={`rounded-md border bg-white ${isDropTarget ? 'border-gray-900' : 'border-gray-200'}`}
      onKeyDown={keyDown}
      onDragOver={(event) => {
        // The innermost row decides, including deciding there is no drop here:
        // an enclosing block claiming the event would highlight itself instead.
        event.stopPropagation();
        // Into its own subtree there is nowhere to land, and the gaps either
        // side of the step are where it already is: offering a drop there
        // would highlight a row and then do nothing.
        if (!dragPath || movesNowhere(dragPath, path) || isDescendant(path, dragPath)) {
          setDropPath(null);
          return;
        }
        event.preventDefault();
        setDropPath(path);
      }}
      // The drop itself is handled by the list holding this row (see StepEditor).
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span
          draggable
          aria-hidden="true"
          className="cursor-grab px-1 text-gray-400 select-none"
          onDragStart={(event) => {
            // Firefox starts no drag at all from an element that sets no data.
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', label);
            // Starting a drag shows a drop zone at the end of every list, which
            // pushes rows down. Doing that inside `dragstart` moves the handle
            // out from under the pointer while Chrome is still deciding whether
            // this is a drag, and it can cancel it. After it, the drag is on.
            dragStartTimer.current = setTimeout(() => setDragPath(path));
          }}
          onDragEnd={() => {
            clearTimeout(dragStartTimer.current);
            setDragPath(null);
            setDropPath(null);
          }}
        >
          ⠿
        </span>
        {children}
        <div className="ml-auto">
          <RowActions step={step} path={path} label={label} />
        </div>
      </div>
    </li>
  );
}

/** Where a row sits in its own list, counting from one, as a reader would say it. */
function position(path: StepPath): number {
  return (path[path.length - 1] ?? 0) + 1;
}

function ExerciseRow({ step, path }: { step: ExerciseStep; path: StepPath }) {
  const { edit } = useEditor();
  // A real category means the exercise was picked from Garmin's taxonomy (here,
  // or before an import), and `exercise` is a key within it, shown by its
  // display name. Text typed over it is free text again: a key edited by hand
  // would be one that exists nowhere, so the category goes back to the
  // placeholder until the next pick sets both.
  const fromTaxonomy = step.category !== PLACEHOLDER_CATEGORY;
  // Unnamed rows are told apart by where they are: three new exercises would
  // otherwise offer three buttons called "Delete exercise".
  const label = fromTaxonomy
    ? displayName(step.exercise ?? step.category)
    : (step.exercise ?? `exercise ${position(path)}`);

  return (
    <StepRow step={step} path={path} label={label}>
      <ExercisePicker
        value={fromTaxonomy ? label : (step.exercise ?? '')}
        onType={(typed) => {
          // The model has no room for a name that is only spaces, and stores
          // none with spaces around it; the box keeps what was typed meanwhile.
          const name = typed.trim();
          edit((steps) =>
            replaceStep(steps, path, {
              ...step,
              category: PLACEHOLDER_CATEGORY,
              // Absent rather than empty: `exercise` is optional in the model,
              // and "" would be a name the schema rejects.
              exercise: name === '' ? undefined : name,
            }),
          );
        }}
        onPick={(exercise) =>
          edit((steps) =>
            replaceStep(steps, path, {
              ...step,
              category: exercise.category,
              exercise: exercise.key,
            }),
          )
        }
      />
      {fromTaxonomy && step.exercise && (
        <span className="text-xs text-gray-500">{displayName(step.category)}</span>
      )}
      <DurationFields step={step} path={path} />
      <NumberField
        label="Weight in kilograms"
        suffix="kg"
        rule={KilogramsSchema}
        optional
        value={step.target?.kg}
        onCommit={(kg) =>
          edit((steps) =>
            replaceStep(steps, path, {
              ...step,
              target: kg === undefined ? undefined : { type: 'weight', kg },
            }),
          )
        }
      />
      {/* Shown as it was before the editor existed, so a note that came in with
          a workout is not silently hidden. Editing notes is not offered yet. */}
      {step.notes && <p className="w-full text-sm text-gray-500">{step.notes}</p>}
    </StepRow>
  );
}

function RestRow({ step, path }: { step: RestStep; path: StepPath }) {
  return (
    <StepRow step={step} path={path} label={`rest ${position(path)}`}>
      <span className="min-w-40 flex-1 text-sm font-medium text-gray-500">Rest</span>
      <DurationFields step={step} path={path} />
    </StepRow>
  );
}

function RepeatRow({ step, path }: { step: RepeatBlock; path: StepPath }) {
  const { edit } = useEditor();

  return (
    <StepRow step={step} path={path} label={`repeat block ${position(path)}`}>
      <span className="text-sm font-semibold tracking-wide text-gray-700 uppercase">Repeat</span>
      <NumberField
        label="Rounds"
        suffix="×"
        rule={RoundsSchema}
        integer
        value={step.rounds}
        onCommit={(rounds) =>
          rounds !== undefined && edit((steps) => replaceStep(steps, path, { ...step, rounds }))
        }
      />
      <div className="mt-2 w-full border-l-2 border-gray-200 pl-4">
        <StepEditor steps={step.steps} path={path} />
      </div>
    </StepRow>
  );
}

/** The gap after the last row: where a step dropped past the end lands. */
function TailDropZone({ steps, path }: { steps: WorkoutStep[]; path: StepPath }) {
  const { dragPath, dropPath, setDropPath } = useEditor();
  const tail = [...path, steps.length];
  const active = dropPath !== null && pathsEqual(dropPath, tail);
  if (!dragPath) return null;

  return (
    <li
      aria-hidden="true"
      className={`h-6 rounded-md border border-dashed ${active ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}
      onDragOver={(event) => {
        event.stopPropagation();
        if (isDescendant(tail, dragPath) || movesNowhere(dragPath, tail)) {
          setDropPath(null);
          return;
        }
        event.preventDefault();
        setDropPath(tail);
      }}
    />
  );
}

/** Adds to the end of whichever list it is rendered under. */
export function AddStepButtons({ steps, path }: { steps: WorkoutStep[]; path: StepPath }) {
  const { edit, focusRequest, requestFocus } = useEditor();
  const where = [...path, steps.length];
  const nested = path.length > 0;
  const firstButton = useRef<HTMLButtonElement>(null);
  // The empty path is a request for the tree's own add buttons: where the cursor
  // goes once the last step is deleted. A nested list's path is its block's,
  // which that block's row answers to instead.
  const focusHere = !nested && focusRequest?.path.length === 0;

  useEffect(() => {
    if (!focusHere) return;
    firstButton.current?.focus();
    requestFocus(null);
  }, [focusHere, requestFocus]);

  function add(step: WorkoutStep) {
    if (edit((current) => insertStep(current, where, step), { moves: true })) requestFocus(where);
  }

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <button
        ref={firstButton}
        type="button"
        className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
        onClick={() => add(newExerciseStep())}
      >
        + Exercise
      </button>
      <button
        type="button"
        className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
        onClick={() => add(newRestStep())}
      >
        + Rest
      </button>
      {/* One level of nesting is all Connect's own editor offers, and a block
          inside a block inside a block is not something a strength session
          needs. The model allows it; the buttons do not encourage it. */}
      {!nested && (
        <button
          type="button"
          className="rounded-md border border-gray-300 px-2.5 py-1 hover:bg-gray-50"
          onClick={() => add(newRepeatBlock())}
        >
          + Repeat block
        </button>
      )}
    </div>
  );
}

export default function StepEditor({ steps, path }: { steps: WorkoutStep[]; path: StepPath }) {
  const { edit, generation, dragPath, setDragPath, dropPath, setDropPath } = useEditor();
  const root = path.length === 0;

  return (
    <ol
      className="flex flex-col gap-2"
      // The gaps between rows, and a block's add buttons, belong to no row. A
      // drop there lands on whatever is already highlighted, so the highlight
      // always shows where a drop will go, rather than the enclosing block
      // claiming the gap as "above the block".
      onDragOver={(event) => {
        event.stopPropagation();
        if (dragPath && dropPath) event.preventDefault();
      }}
      // Every drop in the list, on a row or between rows, arrives here.
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const from = dragPath;
        const to = dropPath;
        setDragPath(null);
        setDropPath(null);
        if (from && to) edit((current) => moveStep(current, from, to), { moves: true });
      }}
      // Only leaving the whole tree clears the target. `dragleave` also fires
      // for every child the pointer crosses inside it, and clearing on each of
      // those re-rendered every row twice per crossing.
      //
      // Safari reports no `relatedTarget` on drag events, which would make
      // every crossing look like leaving. Without one, the target stays put;
      // `dragend` clears it at the end of the drag either way.
      onDragLeave={
        root
          ? (event) => {
              const to = event.relatedTarget as Node | null;
              if (to && !event.currentTarget.contains(to)) setDropPath(null);
            }
          : undefined
      }
    >
      {steps.map((step, index) => {
        const stepPath = [...path, index];
        // Position plus generation: see `generation` on EditorApi.
        const key = `${index}:${generation}`;
        if (step.kind === 'exercise') return <ExerciseRow key={key} step={step} path={stepPath} />;
        if (step.kind === 'rest') return <RestRow key={key} step={step} path={stepPath} />;
        return <RepeatRow key={key} step={step} path={stepPath} />;
      })}
      <TailDropZone steps={steps} path={path} />
      {!root && (
        <li className="pt-1">
          <AddStepButtons steps={steps} path={path} />
        </li>
      )}
    </ol>
  );
}
