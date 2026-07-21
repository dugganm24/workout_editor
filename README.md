# Workout Editor

A fast, keyboard-friendly alternative to Garmin Connect's clunky drag-and-drop workout
editor. Strength training first, other activity types are on the roadmap and open to contribution.

> **Status: under construction.** The project is in early scaffolding. Follow the
> [roadmap](docs/ARCHITECTURE.md) or open an issue to get involved.

## How workouts reach your watch

> [!IMPORTANT]
> Workout Editor's delivery path **requires the free, open-source
> [Share your Garmin Connect workout](https://chromewebstore.google.com/detail/share-your-garmin-connect/kdpolhnlnkengkmfncjdbfdehglepmff)
> Chrome extension** ([source](https://github.com/fulippo/share-your-garmin-workout)).
>
> Garmin Connect has no built-in way to import structured workout files. The extension adds an
> **Import** button to the Garmin Connect website that runs with your existing Connect login.

The flow:

1. Build your workout here and click **Export** to download a Garmin Connect JSON file.
2. On [connect.garmin.com](https://connect.garmin.com)'s workouts page, click the extension's
   **Import Workout** button and select the file.
3. The workout appears in your Connect library and syncs to your watch like any other workout.

You can also go the other way: export an existing Connect workout with the extension and import
it here to edit.

Other delivery paths (`.FIT` file export for USB transfer, direct API sync) are deferred for later
versions, or until demand is demonstrated.

## Why not just use Garmin Connect's editor?

- Building repetitive set/rep structures by drag-and-drop is slow and finicky.
- Editing affordances are missing: no duplicate, painful reordering, limited end conditions.
- This editor is keyboard-friendly, supports repeat blocks, duplication, and fast bulk edits,
  and keeps your workout library local to your browser (no account, no server).

## Development

```sh
npm install
npm run dev        # start the web app
npm test           # run all workspace tests
npm run lint       # oxlint across workspaces
npm run typecheck  # tsc across workspaces
npm run build      # production build
```

The repo is an npm workspace monorepo:

- `packages/core` — canonical workout model (Zod schemas), sport definitions, and the
  Garmin Connect JSON converter. No React, no DOM.
- `packages/web` — the React app (Vite, Tailwind, Zustand).

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design decisions and
[CONTRIBUTING.md](CONTRIBUTING.md) for how to get a change merged.

## License

[MIT](LICENSE). Not affiliated with, endorsed by, or sponsored by Garmin Ltd. "Garmin" and
"Garmin Connect" are trademarks of Garmin Ltd., used here only to describe compatibility.
