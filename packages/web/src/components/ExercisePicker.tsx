import { useId, useState } from 'react';
import { displayName, searchExercises, type Exercise } from '@workout-editor/core';

/**
 * The exercise box: type to search Garmin's taxonomy, arrow down to a match,
 * Enter or click to take it. Recently picked exercises lead the list. Nothing
 * is highlighted until an arrow key says so, so Enter on plain typed text
 * still does what it does in every other box in the row: adds the next step.
 */

const RECENTS_KEY = 'workout-editor:recent-exercises';
const RECENTS_MAX = 8;
const RESULTS_MAX = 12;

const idOf = (exercise: Exercise) => `${exercise.category}/${exercise.key}`;

function readRecents(): Exercise[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(stored) ? (stored as Exercise[]) : [];
  } catch {
    return [];
  }
}

function recordRecent(exercise: Exercise): void {
  const next = [exercise, ...readRecents().filter((r) => idOf(r) !== idOf(exercise))];
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next.slice(0, RECENTS_MAX)));
  } catch {
    // Recents are a convenience; the pick itself is already in the step.
  }
}

/** Search results, with the ones picked recently moved to the front. */
function suggestions(query: string): Exercise[] {
  // Every match, not the first few: a recent pick that matches leads even
  // when the catalog order would have put it past the cut.
  const results = searchExercises(query, Infinity);
  const found = new Set(results.map(idOf));
  const recent = readRecents().filter((r) => found.has(idOf(r)));
  const recentIds = new Set(recent.map(idOf));
  return [...recent, ...results.filter((r) => !recentIds.has(idOf(r)))].slice(0, RESULTS_MAX);
}

export default function ExercisePicker({
  value,
  onType,
  onPick,
}: {
  /** What the box shows when nothing is being typed. */
  value: string;
  /** Every keystroke, as the free-text box always reported it. */
  onType: (text: string) => void;
  onPick: (exercise: Exercise) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const options = open ? suggestions(draft ?? '') : [];
  const highlighted = options[active];

  function pick(exercise: Exercise) {
    recordRecent(exercise);
    onPick(exercise);
    setDraft(null);
    setOpen(false);
    setActive(-1);
  }

  function keyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    // Arrows and Enter during an IME composition steer the candidate list, not ours.
    if (event.altKey || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current) => Math.min(Math.max(current + delta, -1), options.length - 1));
      return;
    }
    if (event.key === 'Enter' && highlighted) {
      event.preventDefault();
      // The row would add the next step on this Enter; the pick is the whole of it.
      event.stopPropagation();
      pick(highlighted);
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    }
  }

  return (
    <span className="relative min-w-40 flex-1">
      <input
        role="combobox"
        aria-label="Exercise"
        aria-expanded={open && options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={highlighted ? `${listId}-${active}` : undefined}
        placeholder="Exercise"
        autoComplete="off"
        className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm font-medium focus:border-gray-500 focus:outline-none"
        value={draft ?? value}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setDraft(null);
          setOpen(false);
          setActive(-1);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
          setActive(-1);
          onType(event.target.value);
        }}
        onKeyDown={keyDown}
      />
      {open && options.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Exercises"
          className="absolute top-full left-0 z-10 mt-1 max-h-64 w-max min-w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
        >
          {options.map((exercise, index) => (
            <div
              key={idOf(exercise)}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-1 ${
                index === active ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
              // Keeps focus in the box, so the blur that would close the list
              // does not arrive before the click.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(exercise)}
            >
              <span className="text-gray-900">{exercise.name}</span>
              <span className="text-xs text-gray-500">{displayName(exercise.category)}</span>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
