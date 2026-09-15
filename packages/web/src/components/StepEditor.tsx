import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  duplicateStep,
  getStep,
  insertStep,
  isDescendant,
  KilogramsSchema,
  moveStep,
  moveStepBy,
  pathAfter,
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
import { newExerciseStep, newRepeatBlock, newRestStep, stepLike } from './stepDefaults.ts';

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
  /** Applies an edit. False when it changed nothing, so there is nothing to follow with the cursor. */
  edit: (mutate: Edit) => boolean;
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
  const [dragPath, setDragPath] = useState<StepPath | null>(null);
  const [dropPath, setDropPath] = useState<StepPath | null>(null);

  // A request only ever names a row the edit just produced. One made for an
  // edit that changed nothing (moving the first row up) names a row that may
  // not exist, and would sit there until some later edit created it and it
  // stole the cursor; `edit` reporting "no change" is what prevents that.
  function applyEdit(mutate: Edit): boolean {
    let changed = false;
    edit((steps) => {
      const next = mutate(steps);
      changed = next !== steps;
      return next;
    });
    return changed;
  }

  const requestFocus = useCallback(
    (path: StepPath | null, control?: number) =>
      setFocusRequest(path === null ? null : { path, control }),
    [],
  );

  return (
    <EditorContext.Provider
      value={{
        edit: applyEdit,
        focusRequest,
        requestFocus,
        dragPath,
        setDragPath,
        dropPath,
        setDropPath,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}

/** Structural, so the editor needs the model's schemas but not zod itself. */
interface NumberRule {
  safeParse: (value: unknown) => { success: boolean };
}

/**
 * A number the model insists on, checked against the model's own schema for
 * that field. Typing passes through a draft so a half-typed value ("", "1" on
 * the way to "12") never reaches the store, where it would fail validation on
 * save and block every save after it.
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

  function change(input: HTMLInputElement) {
    const text = input.value;
    setDraft(text);
    if (text.trim() === '') {
      // A number box reports "" for text it cannot parse yet ("-", ".", "1e")
      // as well as for an empty one. Only a truly empty box clears the value.
      if (optional && !input.validity.badInput) onCommit(undefined);
      return;
    }
    const parsed = Number(text);
    if (!rule.safeParse(parsed).success) return;
    onCommit(parsed);
  }

  return (
    <label className="flex items-baseline gap-1 text-sm">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        min={integer ? 1 : 0}
        step={integer ? 1 : 'any'}
        aria-label={label}
        className="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-gray-500 focus:outline-none"
        value={draft ?? (value === undefined ? '' : String(value))}
        onChange={(event) => change(event.target)}
        // The draft only exists to keep the box usable mid-edit; once focus
        // leaves, the model is the truth again and a rejected value vanishes.
        onBlur={() => setDraft(null)}
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
            if (type === 'reps') setDuration({ type: 'reps', reps: 8 });
            if (type === 'time') setDuration({ type: 'time', seconds: 60 });
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
 * After a delete, the cursor goes to the step that took the deleted one's place,
 * else the one before it, else up a level (a block emptied by the delete is
 * gone too). Never left on the Delete button: rows are keyed by position, so
 * that button now belongs to the next step, and a second Enter would delete it.
 */
function focusAfterRemoval(steps: WorkoutStep[], path: StepPath): StepPath | null {
  for (let at = path; at.length > 0; at = at.slice(0, -1)) {
    if (getStep(steps, at)) return at;
    const index = at[at.length - 1] ?? 0;
    const before = [...at.slice(0, -1), index - 1];
    if (index > 0 && getStep(steps, before)) return before;
  }
  return null;
}

function RowActions({ path, label }: { path: StepPath; label: string }) {
  const { edit, requestFocus } = useEditor();
  const index = path[path.length - 1] ?? 0;

  function move(delta: number, button: Element) {
    if (edit((steps) => moveStepBy(steps, path, delta))) {
      requestFocus([...path.slice(0, -1), index + delta], controlIndex(button));
    }
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
          if (edit((steps) => duplicateStep(steps, path))) requestFocus(pathAfter(path));
        }}
      >
        Duplicate
      </button>
      <button
        type="button"
        aria-label={`Delete ${label}`}
        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        onClick={() => {
          let next: StepPath | null = null;
          const changed = edit((steps) => {
            const after = removeStep(steps, path);
            next = focusAfterRemoval(after, path);
            return after;
          });
          if (changed) requestFocus(next);
        }}
      >
        Delete
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
  const index = path[path.length - 1] ?? 0;
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

  function keyDown(event: React.KeyboardEvent) {
    // Only from a box being typed in: Enter on a button or select is that
    // control's own action, and must not turn into "add a step".
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      // The Enter that confirms an IME candidate belongs to the composition.
      !event.nativeEvent.isComposing &&
      event.target instanceof HTMLInputElement
    ) {
      event.preventDefault();
      // A row inside a block sits inside the block's row too; without this the
      // block would add a step of its own after this one.
      event.stopPropagation();
      const next = pathAfter(path);
      if (edit((steps) => insertStep(steps, next, stepLike(step)))) requestFocus(next);
      return;
    }
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      const delta = event.key === 'ArrowUp' ? -1 : 1;
      if (edit((steps) => moveStepBy(steps, path, delta))) {
        requestFocus([...path.slice(0, -1), index + delta], controlIndex(event.target as Element));
      }
    }
  }

  return (
    <li
      ref={rowRef}
      className={`rounded-md border bg-white ${isDropTarget ? 'border-gray-900' : 'border-gray-200'}`}
      onKeyDown={keyDown}
      onDragOver={(event) => {
        // The innermost row decides, including deciding there is no drop here:
        // an enclosing block claiming the event would highlight itself while
        // the drop still lands on this row.
        event.stopPropagation();
        if (!dragPath || pathsEqual(dragPath, path)) return;
        // Into its own subtree there is nowhere to land.
        if (isDescendant(path, dragPath)) return;
        event.preventDefault();
        setDropPath(path);
      }}
      // Cleared unconditionally: `dragover` fires continuously and the row the
      // pointer moved onto sets itself as the target again straight away.
      onDragLeave={() => setDropPath(null)}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const from = dragPath;
        setDropPath(null);
        setDragPath(null);
        if (from) edit((steps) => moveStep(steps, from, path));
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
        <span
          draggable
          aria-hidden="true"
          className="cursor-grab px-1 text-gray-400 select-none"
          onDragStart={() => setDragPath(path)}
          onDragEnd={() => {
            setDragPath(null);
            setDropPath(null);
          }}
        >
          ⠿
        </span>
        {children}
        <div className="ml-auto">
          <RowActions path={path} label={label} />
        </div>
      </div>
    </li>
  );
}

function ExerciseRow({ step, path }: { step: ExerciseStep; path: StepPath }) {
  const { edit } = useEditor();
  const label = step.exercise ?? 'exercise';

  return (
    <StepRow step={step} path={path} label={label}>
      <input
        aria-label="Exercise"
        placeholder="Exercise name"
        className="min-w-40 flex-1 rounded-md border border-gray-300 px-2 py-1 text-sm font-medium focus:border-gray-500 focus:outline-none"
        value={step.exercise ?? ''}
        onChange={(event) => {
          const name = event.target.value;
          edit((steps) =>
            replaceStep(steps, path, {
              ...step,
              // Absent rather than empty: `exercise` is optional in the model,
              // and "" would be a name the schema rejects.
              exercise: name.trim() === '' ? undefined : name,
            }),
          );
        }}
      />
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
    </StepRow>
  );
}

function RestRow({ step, path }: { step: RestStep; path: StepPath }) {
  return (
    <StepRow step={step} path={path} label="rest">
      <span className="min-w-40 flex-1 text-sm font-medium text-gray-500">Rest</span>
      <DurationFields step={step} path={path} />
    </StepRow>
  );
}

function RepeatRow({ step, path }: { step: RepeatBlock; path: StepPath }) {
  const { edit } = useEditor();

  return (
    <StepRow step={step} path={path} label="repeat block">
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
  const { edit, dragPath, setDragPath, dropPath, setDropPath } = useEditor();
  const tail = [...path, steps.length];
  const active = dropPath !== null && pathsEqual(dropPath, tail);
  if (!dragPath) return null;

  return (
    <li
      aria-hidden="true"
      className={`h-6 rounded-md border border-dashed ${active ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}
      onDragOver={(event) => {
        event.stopPropagation();
        if (isDescendant(tail, dragPath)) return;
        event.preventDefault();
        setDropPath(tail);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const from = dragPath;
        setDropPath(null);
        setDragPath(null);
        edit((steps) => moveStep(steps, from, tail));
      }}
    />
  );
}

/** Adds to the end of whichever list it is rendered under. */
export function AddStepButtons({ steps, path }: { steps: WorkoutStep[]; path: StepPath }) {
  const { edit, requestFocus } = useEditor();
  const where = [...path, steps.length];
  const nested = path.length > 0;

  function add(step: WorkoutStep) {
    if (edit((current) => insertStep(current, where, step))) requestFocus(where);
  }

  return (
    <div className="flex flex-wrap gap-2 text-sm">
      <button
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
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, index) => {
        const stepPath = [...path, index];
        return (
          <div key={index} className="contents">
            {step.kind === 'exercise' && <ExerciseRow step={step} path={stepPath} />}
            {step.kind === 'rest' && <RestRow step={step} path={stepPath} />}
            {step.kind === 'repeat' && <RepeatRow step={step} path={stepPath} />}
          </div>
        );
      })}
      <TailDropZone steps={steps} path={path} />
      {path.length > 0 && (
        <li className="pt-1">
          <AddStepButtons steps={steps} path={path} />
        </li>
      )}
    </ol>
  );
}
