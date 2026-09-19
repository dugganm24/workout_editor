# Garmin Connect workout JSON — format notes

Our export target is the JSON consumed by the
[Share your Garmin Connect workout](https://github.com/fulippo/share-your-garmin-workout)
Chrome extension, which is **Garmin Connect's internal workout-service payload, verbatim**.
This is an undocumented internal format. The extension behaviour below is from its source
(read 2026-07-19); the schema is from golden fixtures in
`packages/core/test/fixtures/connect/`.

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

## Structure from golden fixtures

Four strength GET payloads, all `sportType.sportTypeKey: "strength_training"`
(`sportTypeId` 5, `displayOrder` 4). Each has one segment (`segmentOrder` 1) whose
`workoutSteps` are a flat sequence of `RepeatGroupDTO`s; exercises and rests live
inside those groups. No nested repeats in these files.

Top-level keys present on every export (account fields stripped from fixtures; see
below): `workoutId`, `workoutName`, `description`, `updatedDate`, `createdDate`,
`sportType`, `subSportType`, `trainingPlanId`, `sharedWithUsers`,
`estimatedDurationInSecs`, `estimatedDistanceInMeters`, `workoutSegments`,
`poolLength`, `poolLengthUnit`, `locale`, `workoutProvider`, `workoutSourceId`,
`uploadTimestamp`, `atpPlanId`, `consumer`, `consumerName`, `consumerImageURL`,
`consumerWebsiteURL`, `workoutNameI18nKey`, `descriptionI18nKey`,
`avgTrainingSpeed`, `estimateType`, `estimatedDistanceUnit`, `workoutThumbnailUrl`,
`isSessionTransitionEnabled`, `shared`.

Most of those are `null` / `0` / `false` on these strength workouts. Dates look like
`"2026-09-08T09:23:09.0"`. `estimatedDistanceUnit` at the top level is
`{"unitId":null,"unitKey":null,"factor":null}`.

Segment keys: `segmentOrder`, `sportType`, `poolLengthUnit`, `poolLength`,
`avgTrainingSpeed`, `estimatedDurationInSecs`, `estimatedDistanceInMeters`,
`estimatedDistanceUnit`, `estimateType`, `description`, `workoutSteps`.

```jsonc
{
  "workoutName": "Day 1 - Upper",
  "sportType": {
    "sportTypeId": 5,
    "sportTypeKey": "strength_training",
    "displayOrder": 4,
  },
  "workoutSegments": [
    {
      "segmentOrder": 1,
      "sportType": { "sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 4 },
      "workoutSteps": [
        // RepeatGroupDTO and ExecutableStepDTO, as below
      ],
    },
  ],
}
```

### `RepeatGroupDTO`

Keys in every group: `type` (`"RepeatGroupDTO"`), `stepId`, `stepOrder`, `stepType`,
`childStepId`, `numberOfIterations`, `workoutSteps`, `endConditionValue`,
`preferredEndConditionUnit` (always `null`), `endConditionCompare` (always `null`),
`endCondition`, `skipLastRestStep` (always `false`), `smartRepeat` (always `false`).

```jsonc
{
  "type": "RepeatGroupDTO",
  "stepId": 14552872232,
  "stepOrder": 1,
  "stepType": { "stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6 },
  "childStepId": 1,
  "numberOfIterations": 4,
  "endConditionValue": 4.0,
  "endCondition": {
    "conditionTypeId": 7,
    "conditionTypeKey": "iterations",
    "displayOrder": 7,
    "displayable": false,
  },
  "skipLastRestStep": false,
  "smartRepeat": false,
  "workoutSteps": [/* ExecutableStepDTO children */],
}
```

`numberOfIterations` and `endConditionValue` match. Children are only
`ExecutableStepDTO` here (exercise + rest pairs, or a single timed exercise + rest).

### `ExecutableStepDTO`

Keys in every step: `type` (`"ExecutableStepDTO"`), `stepId`, `stepOrder`, `stepType`,
`childStepId`, `description`, `endCondition`, `endConditionValue`,
`preferredEndConditionUnit` (always `null`), `endConditionCompare`, `targetType`,
`targetValueOne`, `targetValueTwo`, `targetValueUnit`, `zoneNumber`,
`secondaryTargetType`, `secondaryTargetValueOne`, `secondaryTargetValueTwo`,
`secondaryTargetValueUnit`, `secondaryZoneNumber`, `endConditionZone`, `strokeType`,
`equipmentType`, `category`, `exerciseName`, `workoutProvider`,
`providerExerciseSourceId`, `weightValue`, `weightUnit`.

`strokeType` / `equipmentType` are always the unused placeholders
`{strokeTypeId:0,strokeTypeKey:null,displayOrder:0}` and
`{equipmentTypeId:0,equipmentTypeKey:null,displayOrder:0}`. Secondary target fields
and `endConditionZone` are always `null`. `targetType` is either `null` or
`{workoutTargetTypeId:1,workoutTargetTypeKey:"no.target",displayOrder:1}` — no
strength step in these files uses a pace/HR/power target.

`stepType`:

| stepTypeKey | stepTypeId | displayOrder | used for              |
| ----------- | ---------- | ------------ | --------------------- |
| `interval`  | 3          | 3            | exercise              |
| `rest`      | 5          | 5            | rest                  |
| `repeat`    | 6          | 6            | `RepeatGroupDTO` only |

End conditions seen:

| conditionTypeKey | conditionTypeId | displayable | `endConditionValue`                     |
| ---------------- | --------------- | ----------- | --------------------------------------- |
| `reps`           | 10              | true        | rep count (e.g. `6.0`)                  |
| `time`           | 2               | true        | seconds (e.g. `15.0`, `25.0`, `40.0`)   |
| `lap.button`     | 1               | true        | `0.0` (open / until lap press)          |
| `iterations`     | 7               | false       | repeat rounds; only on `RepeatGroupDTO` |

`endConditionCompare` on executable steps is `""`, `"gt"`, or `null` — not a
stable discriminator. All rests in these fixtures are `lap.button` (open); none
are fixed-time. Time-based **exercises** appear on Day 2 (side plank 40s) and
Day 4 (sprint 15s, side plank 25s). There are no open (`lap.button`) **exercise**
steps.

Exercise identity is `category` + `exerciseName`, **not** `exerciseCategory`.
`exerciseName` can be `""` when Connect has a category but no named exercise
(`SHOULDER_PRESS` landmine / machine, `CALF_RAISE`). Rest steps have
`category` and `exerciseName` both `null`. `description` is a free-text note
(`"Pendlay"`, `"Landmine"`, …) or `""` / `null`.

### Weight

`weightUnit` when present is always `{"unitId":9,"unitKey":"pound","factor":453.59237}`.
`weightValue` is a float in that unit (whole pounds come through as values like
`69.99676824369863`). Rests typically still carry `weightUnit` with
`weightValue: null`. Some unweighted steps omit it (`weightUnit: null`): Day 4
sprint, side plank, chop, calf raise.

### `stepOrder` and `childStepId`

`stepOrder` is **global** across the segment: 1…n in tree order, including
repeat wrappers. It does not restart inside a group.

`childStepId` on a `RepeatGroupDTO` is the group number (1, 2, 3, …). Every
child executable step repeats that same `childStepId`.

## Golden fixtures

| File                       | Workout       | What it covers                                                                                       |
| -------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `strength-day1-upper.json` | Day 1 - Upper | 4 repeat supersets, rep+weight, open rests, 8 categories; empty `exerciseName` on `SHOULDER_PRESS`   |
| `strength-day2-lower.json` | Day 2 - Lower | same shape; one timed exercise (side plank 40s); `weightValue: 0` on box jump                        |
| `strength-day3-upper.json` | Day 3 - Upper | same shape as Day 1; more upper-body categories                                                      |
| `strength-day4-lower.json` | Day 4 - Lower | timed sprint + plank; first group is one exercise + rest; `weightUnit` null on some unweighted steps |

These are Connect's own minified GET bodies. Prettier is ignored for
`packages/core/test/fixtures/` so format-check does not rewrite them.

To add another:

1. In Garmin Connect, pick a strength workout **verified on a real watch**.
2. Download via the extension.
3. Name it for what it proves, e.g. `strength-5x5-weighted.json`.
4. **Remove** (do not zero) `ownerId`, `author`, and any other
   account-identifying fields. Leave `workoutId`, dates, and estimates —
   those are format evidence.
5. Confirm `grep -riE 'ownerId|author|displayName|fullName|profileImage|email' packages/core/test/fixtures/connect/` prints nothing.

Still missing vs the original coverage list: nested `RepeatGroupDTO`, a
fixed-time rest, an open (lap-press) exercise step, a ~50-step workout.

## Open questions

- **Field inventory for strength** — recorded above from these GET payloads.
- **Weight units** — pounds (`unitKey: "pound"`, `unitId` 9, `factor` 453.59237).
- **50-step editor limit** — not tested; no fixture that size. (#2 comment: not
  planned.)
- **`stepOrder`** — globally sequential in these exports, not per-group.
- **Minimum viable POST payload** — still unknown. These files are GET
  responses. The extension POSTs essentially the full GET body (and Connect
  accepts leftover owner fields), but that does not tell us which keys POST
  actually requires. Our exports should omit `workoutId` / `ownerId` / `author`
  / dates / estimates anyway.
