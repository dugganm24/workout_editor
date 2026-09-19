# Exercise taxonomy

The editor's exercise picker needs the categories and exercise names Garmin
Connect understands, keyed exactly as its workout JSON expects them
(`BENCH_PRESS` / `INCLINE_DUMBBELL_BENCH_PRESS`). That list lives in
`packages/core/src/exercises/`.

## Where the keys come from

`connect-exercises.json` is Connect's public exercise library, slimmed to
category → exerciseName keys:

https://connect.garmin.com/web-data/exercises/Exercises.json

Regenerate with `npm run generate-catalog -w @workout-editor/core`. Display
names are derived from the keys (`displayName`), so there is nothing else to
keep in step.

Connect sometimes emits a category with `exerciseName: ""` (a landmine under
`SHOULDER_PRESS`, a calf raise with no variant). Those still resolve via
`findCategory`; they are not a separate catalog row.

## Golden fixtures are still required

The catalog is the picker list. The golden fixtures in
`packages/core/test/fixtures/connect/` are real Connect _workout_ payloads —
the format spec for import/export (`docs/connect-format.md`).
`exercises.test.ts` walks them and requires every `category` / `exerciseName`
to resolve, so a catalog refresh cannot drop a key Connect has actually
written. They are not a substitute for each other.

## Why not Garmin's FIT SDK

[Issue #3](https://github.com/dugganm24/workout_editor/issues/3) proposed
generating the taxonomy from the FIT SDK's profile enums. The SDK's licence
(`LICENSE.txt` in `@garmin/fitsdk`) makes that a poor fit for this repo:

- §1 grants use "for Licensee's internal business purposes".
- §2(c) forbids making the Licensed Technology, "or any features or
  functionality" of it, available to third parties.
- §2(d) forbids distributing it or derivatives "so that any part of it becomes
  subject to any license that requires that [it] be disclosed or distributed in
  source code form, or that others have the right to modify it" — which is what
  committing generated enums into this MIT repo would do.

Exercises.json is the same keys Connect's workout editor uses, not that SDK.
The names are still Garmin's. **This is a reading of the situation, not legal
advice.**
