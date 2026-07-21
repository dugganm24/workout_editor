# Garmin Connect workout JSON — format notes

Our export target is the JSON consumed by the
[Share your Garmin Connect workout](https://github.com/fulippo/share-your-garmin-workout)
Chrome extension, which is **Garmin Connect's internal workout-service payload, verbatim**.
This is an undocumented internal format, everything below is derived from the extension
source (read 2026-07-19) and must be confirmed against golden fixtures (see below).

## What the extension actually does

- **Download** (workout page): `GET /gc-api/workout-service/workout/{workoutId}?includeAudioNotes=true`
  with the user's session cookies + `connect-csrf-token` header, and saves the raw response
  as `<workoutName>.json`. No transformation.
- **Import** (workouts list page): reads the chosen JSON file and
  `POST /gc-api/workout-service/workout` with it, after:
  - appending `" - copy"` to `workoutName`;
  - setting every `workoutSegments[].workoutSteps[].stepId` to `null`;
  - _intending_ to delete `workoutId`, `ownerId`, `updatedDate`, `createdDate`, `author`,
    `estimatedDurationInSecs`, `estimatedDistanceInMeters` — but a `for...in`-over-array bug
    means these are never actually removed, and imports still succeed. **Conclusion:
    Connect's POST tolerates those fields**; our exports should simply omit them.
  - On success the response contains the new `workoutId` and `sportType.sportTypeKey`
    (used to redirect to `https://connect.garmin.com/app/workout/{workoutId}`).

## Structure observed so far

Top level (fields the extension relies on):

```jsonc
{
  "workoutName": "Push Day",
  "sportType": { "sportTypeId": ..., "sportTypeKey": "strength_training" },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": { ... },
      "workoutSteps": [
        // ExecutableStepDTO (exercise/rest steps) and RepeatGroupDTO (repeat blocks),
        // each with stepId (null on import), stepOrder, stepType, endCondition,
        // endConditionValue, and for strength: exerciseCategory / exerciseName /
        // weight fields. Exact field set to be pinned down from fixtures.
      ]
    }
  ]
}
```

The exact step-level schema (strength categories/exercise keys, weight units, rep vs time
end conditions, repeat-group nesting) **must be documented from real fixtures, not guessed**.

## Golden fixtures — how to produce them

Fixtures live in `packages/core/test/fixtures/connect/` and are the source of truth for the
converter and its tests. To produce one:

1. In Garmin Connect, build (or pick) a strength workout **that you have verified runs
   correctly on a real watch**.
2. Open the workout page and click the extension's **Download** button.
3. Drop the file into the fixtures directory with a descriptive name, e.g.
   `strength-5x5-with-rests.json`.
4. Sanitize: remove/zero `ownerId`, `author`, and any other account-identifying fields

Good fixture coverage to aim for:

- single exercise, rep-based sets with weight
- time-based sets and "until lap press" (open) sets
- rest steps between sets, fixed-time and open
- repeat groups (e.g. 3 rounds of squat + rest), including nesting if Connect supports it
- a many-step workout near/above 50 steps (probes whether Connect's limit is server-enforced)
- a workout with multiple different exercise categories

## Open questions

- Full `ExecutableStepDTO`/`RepeatGroupDTO` field inventory for `strength_training`.
- Weight units in the payload.
- Whether the 50-step editor limit is enforced by the POST endpoint.
- Whether `stepOrder` must be globally sequential or per-group.
- Minimum viable payload: which fields can be omitted on POST.
