import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { WorkoutStep } from '@workout-editor/core';
import StepList from './StepList.tsx';

describe('StepList', () => {
  it('renders the empty state', () => {
    render(<StepList steps={[]} />);
    expect(screen.getByText('No steps yet.')).toBeInTheDocument();
  });

  it('rounds a fractional duration without rolling over to "1m 60s"', () => {
    render(<StepList steps={[{ kind: 'rest', duration: { type: 'time', seconds: 119.6 } }]} />);
    expect(screen.getByText('2m')).toBeInTheDocument();
  });

  it('renders exercise, rest, and nested repeat blocks', () => {
    const steps: WorkoutStep[] = [
      {
        kind: 'repeat',
        rounds: 3,
        steps: [
          {
            kind: 'repeat',
            rounds: 2,
            steps: [
              {
                kind: 'exercise',
                category: 'BENCH_PRESS',
                exercise: 'BARBELL_BENCH_PRESS',
                duration: { type: 'reps', reps: 5 },
                target: { type: 'weight', kg: 100 },
              },
            ],
          },
          { kind: 'rest', duration: { type: 'time', seconds: 150 } },
        ],
      },
      { kind: 'exercise', category: 'PLANK', duration: { type: 'open' } },
    ];

    render(<StepList steps={steps} />);

    // Both repeat levels render, proving the recursion.
    expect(screen.getByText('Repeat 3×')).toBeInTheDocument();
    expect(screen.getByText('Repeat 2×')).toBeInTheDocument();

    expect(screen.getByText('Barbell Bench Press')).toBeInTheDocument();
    expect(screen.getByText('5 reps')).toBeInTheDocument();
    expect(screen.getByText('100 kg')).toBeInTheDocument();

    expect(screen.getByText('Rest')).toBeInTheDocument();
    expect(screen.getByText('2m 30s')).toBeInTheDocument();

    expect(screen.getByText('Plank')).toBeInTheDocument();
    expect(screen.getByText('until lap press')).toBeInTheDocument();
  });
});
