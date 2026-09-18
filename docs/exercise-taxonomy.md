# Exercise taxonomy

The editor's exercise picker needs the categories and exercise names Garmin
Connect understands, keyed exactly as its workout JSON expects them
(`BENCH_PRESS` / `BARBELL_BENCH_PRESS`). That list lives in
`packages/core/src/exercises/`.

## Where the keys come from

`catalog.ts` is **hand-written and provisional**. It covers the lifts a first
strength session needs, in the key shape Connect uses. Nothing has yet
confirmed each key against Connect itself.

The golden fixtures ([#2](https://github.com/dugganm24/workout_editor/issues/2))
are what confirms them: a real Connect export names its categories and
exercises exactly as Connect expects them back. `exercises.test.ts` holds a
pending test for that check.

## Why not Garmin's FIT SDK

[Issue #3](https://github.com/dugganm24/workout_editor/issues/3) proposed
generating the taxonomy from the FIT SDK's profile enums, which carry 53
categories and ~1,850 exercise names — far more than this catalog.

The SDK's licence (`LICENSE.txt` in `@garmin/fitsdk`) makes that a poor fit for
this repo:

- §1 grants use "for Licensee's internal business purposes".
- §2(c) forbids making the Licensed Technology, "or any features or
  functionality" of it, available to third parties.
- §2(d) forbids distributing it or derivatives "so that any part of it becomes
  subject to any license that requires that [it] be disclosed or distributed in
  source code form, or that others have the right to modify it" — which is what
  committing generated enums into this MIT repo would do.

Generating at build time rather than committing does not clearly help: the
values still end up published in the deployed bundle.

**This is a reading of the licence, not legal advice.** If the full taxonomy
matters, the options are roughly:

1. **Grow the catalog from fixtures.** Every key seen in a real export is a key
   Connect accepts, and comes from the user's own data. Coverage grows with the
   fixtures, and every key is verified. Recommended.
2. **Ask Garmin.** Their developer programme can say whether redistributing the
   exercise enums in an open-source client is permitted.
3. **Another source.** Any list used must have a licence compatible with MIT
   redistribution; check its provenance before importing.

## Adding an exercise

Add the key to the right category in `catalog.ts`. The display name is derived
from the key (`displayName`), so there is nothing else to keep in step. If the
category is new, add it with at least one exercise. Tests cover key shape,
duplicates, and lookup.
