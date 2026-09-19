import { describe, expect, it } from 'vitest';
import day1 from '../../test/fixtures/connect/strength-day1-upper.json' with { type: 'json' };
import day2 from '../../test/fixtures/connect/strength-day2-lower.json' with { type: 'json' };
import day4 from '../../test/fixtures/connect/strength-day4-lower.json' with { type: 'json' };
import { SCHEMA_VERSION, WorkoutSchema, type Workout } from '../model/workout.js';
import { ConnectError, fromConnect, toConnect } from './index.js';

const fixtures = [
  ['day1', day1],
  ['day2', day2],
  ['day4', day4],
] as const;

function withoutId(workout: Workout) {
  const { id: _id, ...rest } = workout;
  return rest;
}

describe('fromConnect', () => {
  it('parses every fixture into a valid workout', () => {
    for (const [label, fixture] of fixtures) {
      const workout = fromConnect(fixture);
      expect(WorkoutSchema.parse(workout), label).toEqual(workout);
      expect(workout.sport).toBe('strength');
      expect(workout.steps.length).toBeGreaterThan(0);
    }
  });

  it('keeps Connect keys, notes, empty exercise names, and converts pounds to kg', () => {
    const workout = fromConnect(day1);
    expect(workout.name).toBe('Day 1 - Upper');
    const first = workout.steps[0];
    expect(first).toMatchObject({ kind: 'repeat', rounds: 4 });
    const incline = first && first.kind === 'repeat' ? first.steps[0] : undefined;
    expect(incline).toMatchObject({
      kind: 'exercise',
      category: 'BENCH_PRESS',
      exercise: 'INCLINE_DUMBBELL_BENCH_PRESS',
      duration: { type: 'reps', reps: 6 },
    });
    expect(incline?.kind === 'exercise' ? incline.target?.kg : undefined).toBeCloseTo(31.75, 5);

    const rowBlock = workout.steps[1];
    const pendlay = rowBlock && rowBlock.kind === 'repeat' ? rowBlock.steps[0] : undefined;
    expect(pendlay).toMatchObject({
      exercise: 'BARBELL_ROW',
      notes: 'Pendlay',
    });

    const landmine =
      workout.steps[2] && workout.steps[2].kind === 'repeat'
        ? workout.steps[2].steps[0]
        : undefined;
    expect(landmine).toMatchObject({ kind: 'exercise', category: 'SHOULDER_PRESS' });
    expect(landmine?.kind === 'exercise' ? landmine.exercise : 'present').toBeUndefined();
  });

  it('treats a 0 lb weight as unweighted', () => {
    const workout = fromConnect(day2);
    const box =
      workout.steps[0] && workout.steps[0].kind === 'repeat'
        ? workout.steps[0].steps[2]
        : undefined;
    expect(box).toMatchObject({ exercise: 'BOX_JUMP', notes: 'Broad jump' });
    expect(box?.kind === 'exercise' ? box.target : undefined).toBeUndefined();
  });

  it('reads timed exercises and unweighted steps', () => {
    const workout = fromConnect(day4);
    const sprint =
      workout.steps[0] && workout.steps[0].kind === 'repeat'
        ? workout.steps[0].steps[0]
        : undefined;
    expect(sprint).toMatchObject({
      category: 'RUN',
      exercise: 'SPRINT',
      duration: { type: 'time', seconds: 15 },
    });
    expect(sprint?.kind === 'exercise' ? sprint.target : undefined).toBeUndefined();
  });

  it('rejects a non-strength sport', () => {
    expect(() => fromConnect({ ...day1, sportType: { sportTypeKey: 'running' } })).toThrow(
      ConnectError,
    );
  });

  it('rejects a step type Connect would not map', () => {
    expect(() =>
      fromConnect({
        workoutName: 'X',
        sportType: { sportTypeKey: 'strength_training' },
        workoutSegments: [{ workoutSteps: [{ type: 'UnknownDTO' }] }],
      }),
    ).toThrow(/unsupported step/);
  });
});

describe('toConnect', () => {
  it('omits server-assigned fields and nulls every stepId', () => {
    const json = toConnect(fromConnect(day1));
    expect(json).not.toHaveProperty('workoutId');
    expect(json).not.toHaveProperty('ownerId');
    expect(json).not.toHaveProperty('author');
    expect(JSON.stringify(json)).not.toMatch(/"stepId":(?!null)/);
  });

  it('refuses a draft with no steps', () => {
    expect(() =>
      toConnect({
        schemaVersion: SCHEMA_VERSION,
        id: 'w1',
        name: 'Empty',
        sport: 'strength',
        steps: [],
      }),
    ).toThrow(/no steps/);
  });
});

describe('round-trip', () => {
  it('fromConnect → toConnect → fromConnect keeps the fields we own', () => {
    for (const [label, fixture] of fixtures) {
      const workout = fromConnect(fixture);
      expect(withoutId(fromConnect(toConnect(workout))), label).toEqual(withoutId(workout));
    }
  });

  it('round-trips a nested repeat the fixtures do not cover', () => {
    const workout: Workout = {
      schemaVersion: SCHEMA_VERSION,
      id: 'nested',
      name: 'Nested',
      sport: 'strength',
      steps: [
        {
          kind: 'repeat',
          rounds: 2,
          steps: [
            {
              kind: 'repeat',
              rounds: 3,
              steps: [
                {
                  kind: 'exercise',
                  category: 'SQUAT',
                  exercise: 'BARBELL_BACK_SQUAT',
                  duration: { type: 'reps', reps: 5 },
                  target: { type: 'weight', kg: 100 },
                },
              ],
            },
            { kind: 'rest', duration: { type: 'open' } },
          ],
        },
      ],
    };
    expect(withoutId(fromConnect(toConnect(workout)))).toEqual(withoutId(workout));
  });
});
