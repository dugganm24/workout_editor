import type { ExerciseStep, RepeatBlock, RestStep, WorkoutStep } from '@workout-editor/core';

/**
 * Read-only rendering of the canonical step tree. The builder UI replaces this
 * with editable rows; the recursion into repeat blocks carries over.
 */

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (!mins) return `${secs}s`;
  return secs ? `${mins}m ${secs}s` : `${mins}m`;
}

function formatDuration(duration: ExerciseStep['duration'] | RestStep['duration']): string {
  switch (duration.type) {
    case 'reps':
      return `${duration.reps} reps`;
    case 'time':
      return formatSeconds(duration.seconds);
    case 'open':
      return 'until lap press';
  }
}

/** Exercise keys are Garmin's SCREAMING_SNAKE enums until the taxonomy lands. */
function humanize(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function ExerciseRow({ step }: { step: ExerciseStep }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <span className="font-medium text-gray-900">{humanize(step.exercise ?? step.category)}</span>
      <span className="text-sm text-gray-600">{formatDuration(step.duration)}</span>
      {step.target && <span className="text-sm text-gray-600">{step.target.kg} kg</span>}
      {step.notes && <span className="w-full text-sm text-gray-500">{step.notes}</span>}
    </div>
  );
}

function RestRow({ step }: { step: RestStep }) {
  return (
    <div className="flex items-baseline gap-x-3">
      <span className="font-medium text-gray-500">Rest</span>
      <span className="text-sm text-gray-600">{formatDuration(step.duration)}</span>
    </div>
  );
}

function RepeatRow({ step }: { step: RepeatBlock }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold tracking-wide text-gray-700 uppercase">
        Repeat {step.rounds}×
      </span>
      <div className="border-l-2 border-gray-200 pl-4">
        <StepList steps={step.steps} />
      </div>
    </div>
  );
}

export default function StepList({ steps }: { steps: WorkoutStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-gray-500">No steps yet.</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => (
        <li key={index} className="rounded-md border border-gray-200 bg-white px-4 py-3">
          {step.kind === 'exercise' && <ExerciseRow step={step} />}
          {step.kind === 'rest' && <RestRow step={step} />}
          {step.kind === 'repeat' && <RepeatRow step={step} />}
        </li>
      ))}
    </ol>
  );
}
