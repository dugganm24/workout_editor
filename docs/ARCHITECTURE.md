# Architecture

## What this is

A static, browser-only workout editor. No backend, no accounts. Workouts live in the
browser (IndexedDB) and are exchanged as files. The app's job is to make _authoring_
structured workouts fast, then hand them to Garmin's ecosystem.

## Delivery: how workouts reach a watch

The **only officially supported path** (V1) is:

```
Workout Editor ──export──▶ Garmin Connect workout JSON
      ▲                            │
      │                    "Share your Garmin Connect workout"
   import                  Chrome extension
      │                            ▼
      └──────────────────── Garmin Connect ──sync──▶ watch
```

- Garmin Connect cannot import structured workout files natively. The open-source
  [Share your Garmin Connect workout](https://github.com/fulippo/share-your-garmin-workout)
  extension adds JSON import/export on the Connect site using the user's logged-in session.
- The converter is **two-way**: users can pull existing Connect workouts into the editor.
- Deferred until later version: `.FIT` export for USB copy (Garmin's FIT JS SDK has a
  browser-capable Encoder, so this remains static-site-compatible), and direct API sync
  (official Garmin Training API needs a backend + partner approval, the unofficial API is
  fragile and CORS-blocked from a static page).

## Repo layout

```
packages/
  core/        # @workout-editor/core
    src/model/     # canonical Workout/Step/Target types (Zod schemas = validation + TS types)
    src/sports/    # sport plugin definitions
    src/connect/   # canonical model ⇄ Garmin Connect workout JSON
    src/exercises/ # exercise taxonomy
  web/         # React app (builder UI, workout library, export/import flow)
docs/          # this file, adding-a-sport.md, connect-format.md
```

## Design rules

1. **The canonical model is ours, not Garmin's.** Workouts are a versioned, Zod-validated
   JSON structure (`schemaVersion` from day 1). Connect JSON is the first compile target,
   FIT, Zwift `.zwo`, etc. can be added later. Breaking schema changes bump the version and
   ship a forward migration so saved/shared workouts never break.
2. **Sport as plugin.** A sport contributes: the step/target types it allows, editor field
   components, and format conversion. Strength is the first plugin, the contract will
   be documented in `docs/adding-a-sport.md` when extracted.
3. **`core` stays framework-free.** Everything in `packages/core` must run in Node and the
   browser with no DOM, it's the future seed of a CLI or published npm package.

## Testing strategy

- **Golden fixtures** are the backbone, real workout JSON exported from Garmin Connect via
  the extension (from workouts verified to run on a real watch) lives in the repo. The
  converter is tested in both directions against them (fixture → canonical → re-export →
  semantic equality).
- Connect's workout JSON is an internal, undocumented format. It can drift, when it does,
  re-exporting fresh fixtures and diffing tells us exactly what changed. `.FIT` export is
  the escape hatch if the format ever becomes hostile.
- Converter/model PRs carry an on-device verification checklist (see the PR template).
  A "tested devices" matrix will live in the README once releases start.

## Tooling decisions

| Concern     | Choice                            | Notes                                                                                               |
| ----------- | --------------------------------- | --------------------------------------------------------------------------------------------------- |
| Language    | TypeScript strict                 | typed workout model is the heart of the app                                                         |
| UI          | React 19 + Vite 8                 |                                                                                                     |
| Lint        | oxlint                            | what the Vite template ships now, faster than ESLint, zero-config                                   |
| Format      | Prettier                          | `npm run format`                                                                                    |
| State       | Zustand                           |                                                                                                     |
| Persistence | IndexedDB via `idb`               |                                                                                                     |
| Styling     | Tailwind CSS 4                    | via `@tailwindcss/vite`                                                                             |
| Tests       | Vitest (+ Testing Library in web) |                                                                                                     |
| Hosting     | Cloudflare Pages                  | free static hosting, unlimited bandwidth, per-PR preview URLs                                       |
| Releases    | release-please                    | SemVer from Conventional Commits; `0.x` until on-watch behavior is validated across device families |

## Non-goals (V1)

- No accounts, no server, no data leaving the browser.
- No training plans / calendar scheduling.
- No activity analysis. Authoring only, not a training log.
