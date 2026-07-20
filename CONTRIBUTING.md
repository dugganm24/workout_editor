# Contributing to Workout Editor

Thanks for helping build a better workout editor! Contributions of all sizes are welcome —
bug reports, docs fixes, new features, and especially new sport types.

## Getting started

```sh
git clone https://github.com/dugganm24/workout_editor.git
cd workout_editor
npm install
npm run dev
```

Requirements: Node.js ≥ 20 and npm ≥ 10.

## Making a change

1. Fork and branch from `main`.
2. Make your change, with tests where behavior changes.
3. Run the full check suite locally: `npm run lint && npm run typecheck && npm test`.
4. Open a PR. CI must be green; every PR gets a live preview deployment to click through.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) — they drive automated
releases and the changelog:

- `feat: add superset support to the step editor`
- `fix: preserve rest steps when reordering repeat blocks`
- `docs:`, `chore:`, `refactor:`, `test:` as appropriate.

PRs are squash-merged, so the **PR title** must follow the convention too.

### Changes that affect exported workouts

Anything touching `packages/core/src/connect/` (the Garmin Connect JSON converter) or the
workout model can break real workouts on real watches. For those PRs:

- Add or update golden-fixture tests.
- Fill in the on-device testing checklist in the PR template (which device you verified on, or
  state that you couldn't — a maintainer will verify before release).

## Adding a new sport type

Strength is the first sport, but the model is built for more (running, cycling, cardio, …).
The contract for a sport plugin is documented in `docs/adding-a-sport.md` (coming with the
first plugin extraction). Until then, open a "New sport request" issue to discuss the shape
before building.

## Reporting bugs

Use the bug report issue template. For workout export bugs, please attach the exported JSON
and name your device model — that's usually the whole diagnosis.

## Code of Conduct

Be kind. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
