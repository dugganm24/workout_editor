# Deploying (Cloudflare Pages)

The site deploys via Cloudflare Pages' GitHub integration: every merge to `main` goes to
production, every PR gets a preview URL. One-time setup (repo owner):

1. Sign up / log in at [dash.cloudflare.com](https://dash.cloudflare.com) (free plan).
2. **Workers & Pages → Create → Pages → Connect to Git**, authorize GitHub, pick
   `dugganm24/workout_editor`.
3. Build settings:
   - **Project name:** `workout-editor` (→ site at `https://workout-editor.pages.dev`)
   - **Production branch:** `main`
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `packages/web/dist`
   - **Root directory:** leave as `/` (the build must run at the repo root so npm
     workspaces resolve `@workout-editor/core`)
4. Save and deploy. PR preview deployments are on by default.

No environment variables or secrets are needed — the site is fully static.
