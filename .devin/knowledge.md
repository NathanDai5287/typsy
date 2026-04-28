# Typsy — Project Knowledge

A keyboard-navigable web app for learning new keyboard layouts (QWERTY, Colemak, Colemak DH, Graphite, Dvorak, Workman, Canary, plus user-created layouts). Single-user, local-first, SQLite-backed.

This file is the source of truth for project structure and conventions. **Do not re-explore the repo to learn its shape** — read this first. If something below is wrong or stale, fix it as part of your PR.

---

## Architecture map

```
/                            # pnpm workspace root
├── apps/
│   ├── server/              # Express + better-sqlite3 backend (port 3001)
│   └── web/                 # Vite + React 18 + Tailwind frontend (port 5173)
├── packages/
│   └── shared/              # Pure-function library: types, layouts, algorithms (no I/O)
├── pnpm-workspace.yaml      # Lists apps/* and packages/* as workspaces
├── tsconfig.base.json       # Strict TS config inherited by every package
├── README.md                # User-facing project intro
├── DEVELOPMENT.md           # Day-to-day commands, seed script, DB reset
└── .devin/                  # Devin agent context (this file lives here)
```

### `apps/server/` — Node + Express + better-sqlite3 (TypeScript, ESM)
- **Entry point:** <ref_file file="/Users/natha/Programming/typsy/apps/server/src/index.ts" /> — boots Express on port 3001, mounts four routers, calls `getDb()` to run migrations + seed. After the API mounts, a production block static-serves `apps/web/dist/` (resolved from `dist/index.js` as `../../web/dist`) and falls back to `index.html` for any non-`/api/*` GET, so a single Express process can serve both the API and the SPA on one origin behind a single Cloudflare hostname (typsy.cal.taxi). The block is guarded with `fs.existsSync` so dev (where `apps/web/dist` may be stale or absent) is unaffected.
- `src/db/client.ts` — `getDb()` opens `apps/server/data/typsy.db`, applies any new `*.sql` files in `migrations/` (in lexical order, tracked via `_migrations` table), then runs `seedData()`.
- `src/db/migrations/*.sql` — schema migrations. `001_initial.sql` defines `users`, `layouts`, `user_layout_progress`, `sessions`, `ngram_stats`. `002_main_layout.sql` adds `is_main_layout` flag. `003_user_fingering.sql` moves fingerings off `user_layout_progress` (where they were char-keyed and per-layout) onto `users.fingering_map_json` (position-keyed `"row,col"` → `FingerLabel`, layout-independent). `004_firebase_auth.sql` adds nullable `users.firebase_uid TEXT UNIQUE` so Firebase-signed-in accounts can be linked to a row.
- `src/db/seed.ts` — inserts the three built-in layouts plus two users: `id=1` (real) and `id=2` (synthetic). The schema already keys every per-user table by `user_id`, so the two are fully isolated.
- `src/db/dataMode.ts` — dev-only switch used **only when `BYPASS_AUTH=1`**. `getCurrentUserId()` reads `process.env.TYPSY_DATA_MODE` ('synthetic' → `id=2`, else → `id=1`). In normal (auth-enabled) mode the routes ignore this entirely and read `req.userId` set by the auth middleware.
- `src/auth.ts` — Firebase Admin token verification. `authMiddleware` reads `Authorization: Bearer <token>`, verifies via `firebase-admin`, resolves the UID to a row in `users` (via `firebase_uid`), and sets `req.userId`. First sign-in by `TYPSY_OWNER_FIREBASE_UID` is stamped onto `user_id=1` so the existing pre-auth practice data stays linked to the owner. `BYPASS_AUTH=1` skips verification and falls back to `getCurrentUserId()`.
- `src/routes/{user,layouts,sessions,ngrams}.ts` — Express routers under `/api/user`, `/api/layouts`, `/api/sessions`, `/api/ngrams`. All routes pull `userId = requireUserId(req)` from `auth.ts`. The middleware is mounted on `/api` in `index.ts` AFTER the public `/api/health` ping but BEFORE every protected router.
- `scripts/seed-dev-data.ts` — dev-only synthetic data generator for the optimizer gate. **Non-destructive** — only ever wipes/writes `user_id=2` rows; real `user_id=1` data is untouched.
- DB file: `apps/server/data/typsy.db` (gitignored). Created automatically on first server boot.

### `apps/web/` — Vite + React 18 + Tailwind (TypeScript, ESM)
- **Entry point:** <ref_file file="/Users/natha/Programming/typsy/apps/web/src/main.tsx" /> — wraps `<App>` in `BrowserRouter` + `QueryClientProvider`.
- `src/App.tsx` — gates the app on `useAuth()`: while Firebase resolves the auth state shows a "signing in…" splash; if no user is signed in (and `VITE_BYPASS_AUTH` isn't set) renders `LoginPage` instead of the app shell. Once signed in, fetches the user once via TanStack Query and redirects to `/onboarding` if no `layout_progress`. All app routes mounted here.
- `src/pages/` — one `*Page.tsx` per route: `Onboarding`, `Practice`, `Dashboard`, `Optimize`, `Layouts`, `Fingering`, `Settings`.
- `src/components/` — `Nav.tsx` (top nav, hidden during onboarding), `StatusBar.tsx` (vim-style bottom bar with route + keymap hints), `HelpOverlay.tsx` (full-screen `?` shortcut reference), `LeaderHint.tsx` (small popover when the `g` nav leader is armed), `KeyboardVisual.tsx` (on-screen keyboard with finger colors + opacity-fade for muscle memory + heatmap support), and `FingeringEditor.tsx` (reusable click-or-keyboard editor used in onboarding and on `/fingering`).
- `src/lib/api.ts` — typed fetch wrappers around every `/api/*` endpoint. **All HTTP goes through here.** Reads `VITE_API_BASE_URL` (defaults to `/api` for same-origin) and attaches `Authorization: Bearer <firebase-id-token>` to every request via `getCurrentIdToken()` from `lib/auth.tsx`.
- `src/lib/firebase.ts` — Firebase web SDK init from `VITE_FIREBASE_*` env vars. Throws loudly if any required value is missing.
- `src/lib/auth.tsx` — `AuthProvider` (subscribes to `onAuthStateChanged`, exposes `useAuth()`), plus a `setTokenGetter`/`getCurrentIdToken` singleton pair so `lib/api.ts` can pull a fresh ID token without prop-drilling. `VITE_BYPASS_AUTH=1` short-circuits the whole module and pretends the user is signed in (mirror of the server's `BYPASS_AUTH=1`).
- `src/pages/LoginPage.tsx` — the unauthenticated landing page; one button kicks off `signInWithPopup(googleProvider)`.
- `src/lib/ngramTracker.ts` — buffers char/word ngram deltas in memory, flushes every 30s and on session end via `POST /api/ngrams/batch`.
- `src/lib/finger-colors.ts` — finger → Tailwind color mapping + display labels (Gruvbox Material palette).
- `src/lib/keymap.ts` — `useKeymap()` hook: subscribe `Keybinding[]` to a document-level keydown listener. Bindings are matched by `event.code` (layout-agnostic), with optional modifier sets. The matched handler always calls `stopImmediatePropagation` so a page-level binding cleanly suppresses any sibling global binding on the same document.
- `src/lib/keymapContext.tsx` — `KeymapProvider` (wraps the whole app, owns the global keymap + the `g` nav leader + the help overlay state) and `useRegisterPageKeymap(title, bindings)` (pages call this to register their own bindings AND have them appear in the help overlay).
- Vite proxies `/api` → `http://localhost:3001` (see `vite.config.ts`).

### `packages/shared/` — Pure logic, no I/O (TypeScript, ESM)
- Single barrel export at `src/index.ts`. Every consumer imports from `@typsy/shared`.
- **No file in this package may read from disk, hit the network, or use globals other than `Math.random`** (which is injectable as `rng`). Everything is unit-testable in vitest with `environment: 'node'`.
- **Has a tsc build step** (`pnpm --filter @typsy/shared build` → `dist/`). The package's `exports.default` points to `./dist/index.js` so it can be loaded by raw Node (production: `node dist/index.js` in `apps/server/`). `exports.types` still points to `./src/index.ts` for in-repo TS consumers. `pnpm dev` does a one-shot shared build before starting the concurrent watchers (`tsc -w` for shared, `tsx watch` for server, `vite` for web), so source edits in `packages/shared/src/` re-emit `dist/` and trigger a server restart.
- See "Where to find X" below for which file does what.

---

## Tech stack & commands

| Layer | Tech |
|---|---|
| Language | TypeScript 5.4.5, strict mode (`tsconfig.base.json`) |
| Module system | ESM everywhere (`"type": "module"` in every package.json) |
| Package manager | **pnpm 10.x** with workspaces (`pnpm-workspace.yaml`) |
| Backend | Node 20+, Express 4.19, better-sqlite3 9.6 |
| Backend dev runner | `tsx watch` (no build step in dev) |
| Frontend | React 18.3, react-router-dom 6.24, @tanstack/react-query 5.45, zustand 4.5, Recharts 2.12 |
| Frontend bundler | Vite 5.3 + `@vitejs/plugin-react` |
| Styling | Tailwind 3.4 + PostCSS, custom Catppuccin Mocha palette in `apps/web/tailwind.config.js` |
| Test runner | Vitest 1.6 (`environment: 'jsdom'` for web, `'node'` for shared/server) |
| Web testing libs | @testing-library/react 16, @testing-library/user-event 14 |
| Type-checking | `tsc --noEmit` (web) and `tsc` (server, emits to `dist/`) — both run via `pnpm build` |

### Exact commands

```bash
# Install (once, after clone)
pnpm install

# Dev (web on 5173 + server on 3001 with hot reload, against the local SQLite)
pnpm dev                  # same as --db=staging
pnpm dev --db=staging     # explicit: local server + local DB
pnpm dev --db=prod        # SSH tunnel to production API; web only locally
                          #   (vite still on 5173; localhost:3001 becomes the
                          #    tunnel to natha@ssh.cal.taxi:3001 — every API
                          #    call writes to the production SQLite. No local
                          #    server runs in this mode. Ctrl-C to stop.)

# Build (typecheck + emit shared dist + server dist + web dist; runs in topological order)
pnpm build

# Test (all packages)
pnpm test

# Per-package
pnpm --filter web dev
pnpm --filter server dev
pnpm --filter web test
pnpm --filter server test
pnpm --filter @typsy/shared test
pnpm --filter @typsy/shared build  # tsc → packages/shared/dist/
pnpm --filter web build            # tsc && vite build
pnpm --filter server build         # tsc + cp -R src/db/migrations → apps/server/dist/

# Dev seed (writes synthetic ngrams + sessions to user_id=2; never touches real data)
pnpm --filter server seed:dev                  # Colemak, 100k chars
pnpm --filter server seed:dev Graphite         # named layout, 100k chars
pnpm --filter server seed:dev Colemak 200000   # custom char target

# Single command: seed synthetic data + run dev server in synthetic mode
pnpm dev:synth

# Run dev server in real mode (default)
pnpm dev

# Wipe entire DB (deletes BOTH real and synthetic data)
rm apps/server/data/typsy.db*
```

There is no separate `lint` or `typecheck` command — `pnpm build` is the typecheck. There is no Prettier/ESLint config in this repo as of now.

---

## Conventions

### File naming
- React components and pages: PascalCase (e.g. `PracticePage.tsx`, `KeyboardVisual.tsx`).
- All other TS files: camelCase (e.g. `ngramTracker.ts`, `keyUnlock.ts`, `inputMode.ts`).
- Tests live next to source: `foo.ts` ↔ `foo.test.ts`. Same directory.
- SQL migrations: `NNN_snake_case.sql` (e.g. `001_initial.sql`, `002_main_layout.sql`). Three-digit zero-padded prefix, applied in lexical order, never edited after merge.

### Import style
- ESM with explicit `.js` extensions on relative imports inside `apps/server/` (NodeNext requires it). Example: `import { getDb } from '../db/client.js';` even though the source is `client.ts`.
- Web (`apps/web/`) uses `.ts`/`.tsx` extensions on relative imports (Vite + `allowImportingTsExtensions: true`). Example: `import App from './App.tsx';`.
- `@typsy/shared` uses `.js` extensions internally (matching its barrel export at `src/index.ts`).
- Always import from the package barrel: `import { translateKeypress, generateDrillSequence } from '@typsy/shared';` — never reach into `@typsy/shared/src/...` directly.
- Type-only imports use `import type { ... }`.

### Error handling
- **Server routes** validate body shape inline, return `res.status(4xx).json({ error: '...' })` and `return;` early. No global error middleware. See <ref_snippet file="/Users/natha/Programming/typsy/apps/server/src/routes/user.ts" lines="103-118" /> for the canonical pattern.
- **DB writes that touch multiple tables** must be wrapped in `db.transaction(() => { ... })` — see <ref_snippet file="/Users/natha/Programming/typsy/apps/server/src/routes/layouts.ts" lines="107-114" />.
- **Frontend HTTP** goes through `request<T>()` in `src/lib/api.ts`, which throws on `!res.ok` with the status text. Components let TanStack Query surface the error.
- Pure-function libs in `packages/shared/` should not throw on bad input — return sensible defaults (empty arrays, zero scores) and let the caller decide.

### How to add X — one example each

| Add a... | Steps | Reference example |
|---|---|---|
| API route | (1) Create handler in `apps/server/src/routes/<file>.ts` exporting an Express `Router`. (2) Mount in `apps/server/src/index.ts` with `app.use('/api/foo', fooRouter)`. (3) Add typed wrapper in `apps/web/src/lib/api.ts`. (4) Add request/response types to `packages/shared/src/types.ts` if not already there. | `apps/server/src/routes/sessions.ts` |
| React route/page | (1) Create `apps/web/src/pages/FooPage.tsx`. (2) Register in `apps/web/src/App.tsx` `<Routes>`. (3) Add a `<NavLink>` in `apps/web/src/components/Nav.tsx` if user-visible. | `apps/web/src/pages/SettingsPage.tsx` |
| DB migration | Drop a new `NNN_description.sql` file in `apps/server/src/db/migrations/` using the next number. Migrations are wrapped in a transaction. They run on next server boot. **Never edit an already-merged migration** — write a new one. | `apps/server/src/db/migrations/002_main_layout.sql` |
| Shared algorithm | Add a new `*.ts` file under `packages/shared/src/`, write tests in `*.test.ts` next to it, then export from `packages/shared/src/index.ts`. Pure function only — no I/O, no globals other than `Math.random` (inject as `rng` for tests). | `packages/shared/src/drill.ts` + `drill.test.ts` |
| Layout | Append a new `LayoutGrid` to `packages/shared/src/layouts.ts` and add it to `LAYOUT_DEFINITIONS`. The seeder + `SEEDED_LAYOUT_NAMES` (which is what `apps/server/src/routes/layouts.ts` checks for delete-protection) both derive from that array, so adding a row there is sufficient. Cite a canonical reference (URL) in the comment above the grid so future agents can verify. Add at least a couple of `translateKeypress` smoke tests in `packages/shared/src/inputMode.test.ts` covering the layout's home row + one signature key. | `Canary` / `Workman` blocks in `packages/shared/src/layouts.ts` |
| Tunable constant | Add to `packages/shared/src/constants.ts` and consume from `@typsy/shared`. | `OPTIMIZER_MIN_CHARS` |

---

## Where to find X

### Frontend pages and routes
| Concern | Path |
|---|---|
| Route table | `apps/web/src/App.tsx` |
| Practice page (typing loop, mode toggle, keyboard) | `apps/web/src/pages/PracticePage.tsx` |
| Dashboard (charts, heatmaps, top-N weak ngrams) | `apps/web/src/pages/DashboardPage.tsx` |
| Onboarding (3 steps: daily driver → optional learn-layout → fingering) | `apps/web/src/pages/OnboardingPage.tsx` |
| Optimize page (50k-char gate, before/after heatmaps) | `apps/web/src/pages/OptimizePage.tsx` |
| Layouts list + switch / mark-as-daily-driver | `apps/web/src/pages/LayoutsPage.tsx` |
| Fingering editor (per-layout finger reassignment) | `apps/web/src/pages/FingeringPage.tsx` |
| Settings (placeholder) | `apps/web/src/pages/SettingsPage.tsx` |
| Top nav | `apps/web/src/components/Nav.tsx` |
| On-screen keyboard | `apps/web/src/components/KeyboardVisual.tsx` |
| Reusable fingering editor (click key, pick finger) | `apps/web/src/components/FingeringEditor.tsx` |

### Frontend libraries
| Concern | Path |
|---|---|
| HTTP client | `apps/web/src/lib/api.ts` |
| Ngram batching/flush | `apps/web/src/lib/ngramTracker.ts` |
| Finger color palette | `apps/web/src/lib/finger-colors.ts` |
| QueryClient config | `apps/web/src/main.tsx` |
| Tailwind config (Catppuccin) | `apps/web/tailwind.config.js` |
| Vite config + `/api` proxy | `apps/web/vite.config.ts` |
| Top-level HTML | `apps/web/index.html` |

### Backend
| Concern | Path |
|---|---|
| Server entry / port / CORS | `apps/server/src/index.ts` |
| DB client + migration runner + seed orchestration | `apps/server/src/db/client.ts` |
| Schema (initial) | `apps/server/src/db/migrations/001_initial.sql` |
| Built-in layout + user seed | `apps/server/src/db/seed.ts` |
| User + onboarding + progress + active layout | `apps/server/src/routes/user.ts` |
| Layouts (list, create, delete, summary) | `apps/server/src/routes/layouts.ts` |
| Session create / list | `apps/server/src/routes/sessions.ts` |
| Ngram batch upsert / stats query | `apps/server/src/routes/ngrams.ts` |
| Dev data seeder | `apps/server/scripts/seed-dev-data.ts` |
| SQLite DB file (gitignored) | `apps/server/data/typsy.db` |

### Shared package (`@typsy/shared`)
| Concern | Path |
|---|---|
| Barrel export | `packages/shared/src/index.ts` |
| All cross-package types (User, Layout, Session, NgramStat, payloads) | `packages/shared/src/types.ts` |
| Tunable constants (UNLOCK_WPM, OPTIMIZER_MIN_CHARS, BAYESIAN_ALPHA, etc.) | `packages/shared/src/constants.ts` |
| Layout grid definitions (QWERTY, Colemak, Colemak DH, Graphite, Dvorak, Workman, Canary) + builders + `posKey()` (canonical `"row,col"` key for position-based maps) | `packages/shared/src/layouts.ts` |
| Physical-key → logical-char translation | `packages/shared/src/inputMode.ts` |
| Bayesian smoothing (Beta(1,9) prior) | `packages/shared/src/bayesian.ts` |
| Ngram index + backoff lookup | `packages/shared/src/ngramStats.ts` |
| English word list (top 10k a-z, no single-letter repeats) | `packages/shared/src/wordList.ts` + `wordListData.ts` |
| English bigram corpus stats + weak-bigram ranking | `packages/shared/src/markov.ts` |
| Initial home-row subset selection | `packages/shared/src/initialSubset.ts` |
| Key unlock / review-resurface logic | `packages/shared/src/keyUnlock.ts` |
| Drill-mode sequence generator | `packages/shared/src/drill.ts` |
| Flow-mode sequence generator | `packages/shared/src/flow.ts` |
| Per-finger / per-key roll-ups for dashboard | `packages/shared/src/analysis.ts` |
| Bigram difficulty model (SFB, scissor, lateral, alternation, rolls) | `packages/shared/src/difficulty.ts` |
| Layout cost function (frequency × difficulty × user miss rate) | `packages/shared/src/cost.ts` |
| Simulated annealing optimizer | `packages/shared/src/annealing.ts` |
| Curated practice corpus | `packages/shared/src/corpus.ts` |

### Cross-cutting
| Concern | Path |
|---|---|
| Workspace definition | `pnpm-workspace.yaml` |
| Shared TS config | `tsconfig.base.json` |
| Top-level scripts | `package.json` |
| Day-to-day dev commands & seed/reset docs | `DEVELOPMENT.md` |
| User-facing intro | `README.md` |
| Devin agent config (gitignored local override allowed) | `.devin/config.local.json` |
| CI workflow (build + test + auto-merge) | `.github/workflows/ci.yml` |
| Pull-merged-work helper | `scripts/devin-pull.sh` |

### Things that DO NOT exist (don't go looking)
- **Custom auth backend.** Firebase Auth (Google provider) handles identity entirely. There are no login routes in `apps/server/src/routes/`, no password storage, no session cookies, no JWT-issuing endpoints. The server only *verifies* Firebase-issued ID tokens via `firebase-admin`.
- **Feature flags.** None.
- **Docker / containers.** Not configured.
- **Lint / format config.** No ESLint, no Prettier. Match existing style by reading the file you're editing.

### Env vars
Server (`apps/server/.env`, gitignored, see `.env.example`):
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` — service-account credentials for `firebase-admin`. Or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account JSON file.
- `TYPSY_OWNER_FIREBASE_UID` — UID stamped onto `user_id=1` on first sign-in to preserve pre-auth practice data.
- `PORT` (default 3001), `ALLOWED_ORIGIN` (extra CORS origins, comma-separated).
- `BYPASS_AUTH=1` + `TYPSY_DATA_MODE` (`'synthetic'` or unset) — dev-only escape hatch to skip Firebase verification.

Web (`apps/web/.env.local`, gitignored, see `.env.example`):
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` — public client config; embedded in the bundle at build time.
- `VITE_API_BASE_URL` — defaults to `/api`. Set to a full URL when frontend and backend live on different hosts (e.g. Vercel + cloudflared tunnel).
- `VITE_BYPASS_AUTH=1` — mirror of the server flag for UI-only dev.

---

## Gotchas

- **DB schema is gitignored.** The SQLite file at `apps/server/data/typsy.db` is created on first server boot via the migration runner. If your changes look like they're not applied, `rm apps/server/data/typsy.db*` and re-run `pnpm dev` (the runner is idempotent and re-creates everything from migrations + seed).
- **Migrations are append-only.** `_migrations` table records every applied file. **Never edit an already-applied migration** — even in dev. Add a new `NNN_*.sql` file instead.
- **Seed script is non-destructive to real data.** `pnpm --filter server seed:dev <layout>` only ever wipes/writes `user_id=2` (the synthetic user). `user_id=1` (your real practice data) is never touched. To view what was seeded, restart the server in synthetic mode (`TYPSY_DATA_MODE=synthetic pnpm dev`, or just `pnpm dev:synth` which does the seed + restart in one go).
- **`pnpm dev` vs `pnpm dev:synth`.** `dev` runs in real mode (`user_id=1`); `dev:synth` runs `seed:dev` then starts dev with `TYPSY_DATA_MODE=synthetic` (`user_id=2`). The mode is fixed at server startup — to switch, stop the server and start it with the other command. There is intentionally no UI toggle.
- **`tsx watch` may not see fresh DB rows.** A long-running better-sqlite3 connection caches schema. After running `seed:dev`, restart `pnpm dev` / `pnpm dev:synth` if the dashboard or `/optimize` looks stale.
- **Server uses NodeNext module resolution; web uses Bundler.** That's why server-side relative imports need `.js` extensions and web-side ones use `.ts`/`.tsx`. Don't "fix" what looks like an inconsistency — it's deliberate per `tsconfig.json` in each app.
- **`KeyboardEvent.code` (not `key`) is the source of truth for typing.** `code` is layout-independent — `KeyF` is always the F-position key regardless of OS keyboard setting. The `translateKeypress` function in `packages/shared/src/inputMode.ts` maps `event.code` → row/col → active-layout char. **Do not switch to `event.key`** — it would break the whole "practice any layout from a QWERTY OS" premise.
- **Fingerings are user-level and keyed by physical position, NOT by character.** `users.fingering_map_json` is a JSON `Record<"row,col", FingerLabel>` (use `posKey(pos)` from `packages/shared/src/layouts.ts` to compute the key). The same map applies to every layout because the user's hands are anchored to physical keys, not to the chars a layout puts there. `KeyPosition.finger` (the column-based default in `COL_TO_FINGER`) is the fallback for any position the user hasn't customized. `buildFingerMap` and `buildLayoutIndex` both take this position-keyed override and resolve to a `char → finger` map at the layout boundary. The `/fingering` page is a single editor with no layout picker (the layout button there is a *display* choice — switching it doesn't move the data, since the data isn't tied to a layout). The optimizer no longer needs to "reset" fingering on a generated layout: positions persist across the swap, so the user's map carries through automatically.
- **Onboarding is two decisions, not one.** The flow is `daily driver → optional learn-layout → fingering`. The daily driver defaults to QWERTY (overwhelming-majority assumption) and is created with `is_main_layout = 1` and every alpha key already unlocked — no progressive ramp-up, since the user already knows it. The learn-layout (default Colemak, skippable) is created with `is_main_layout = 0` and the standard initial-subset unlock; when present it becomes the active layout, so `/practice` opens straight on the new thing the user is here to learn. Both rows + the active-layout pointer are written by `POST /api/user/initial-setup` in a single `db.transaction` — that endpoint also resets `is_main_layout = 0` on every existing row first so re-running with a different daily-driver choice doesn't leave a phantom second flag. The older `POST /api/user/onboarding` (single layout, no `is_main_layout` flag) still exists and is used by the "Set up" button on `/layouts` for adding additional learning layouts to an already-onboarded user.
- **`is_main_layout` is a per-user uniqueness invariant, not just a row flag.** A user has at most one daily driver, but the schema can't express that as a constraint (it'd need a partial unique index keyed on `user_id WHERE is_main_layout = 1`). The invariant is enforced at the application layer: `POST /api/user/initial-setup` clears the flag on every other row before setting the new one (see above), and `POST /api/user/progress` does the same when `is_main_layout: true` is in the body — both wrap the clear + set + active-layout write in `db.transaction(...)` so a partial commit can't leave the user with zero or two daily drivers. The `/progress` route also writes `settings.active_layout_id = layout_id` when promoting, so "Mark daily driver" on the Layouts page is a single-action switch (otherwise the user clicks the toggle and the practice page is still sitting on the old layout, making the toggle look broken). Setting `is_main_layout: false` only clears the flag on the target row and leaves `active_layout_id` alone — un-marking shouldn't bounce the user off whatever layout they're currently typing on.
- **The Graphite layout in `packages/shared/src/layouts.ts` is a best-effort placeholder.** See the `TODO` comment there. Not yet validated against the official reference.
- **Built-in layouts (QWERTY, Colemak, Colemak DH, Graphite, Dvorak, Workman, Canary) cannot be deleted.** `SEEDED_LAYOUT_NAMES` (sourced from `LAYOUT_DEFINITIONS` in `packages/shared/src/layouts.ts`) is what `apps/server/src/routes/layouts.ts` checks against, so to enroll a new built-in layout you only need to add it to `LAYOUT_DEFINITIONS` — the seeder + the delete-guard pick it up automatically.
- **All pure-function tests must work without a real `Math.random`.** Functions like `generateDrillSequence`, `generateFlowLine`, `runAnnealing` accept an injectable `rng` parameter — use it in tests for determinism.
- **Tailwind theme is custom (Gruvbox Material Dark Hard).** Don't introduce ad-hoc hex colors; use the named tokens defined in `apps/web/tailwind.config.js` (`bg_h`, `bg0`-`bg5`, `fg0`-`fg4`, `fg_h`, `accent`). The legacy Catppuccin names (`crust`, `mantle`, `surface*`, etc.) are still aliased to surfaces for compatibility but new code should prefer the Gruvbox tokens.
- **All keyboard shortcuts use `KeyboardEvent.code`, not `event.key`.** This is the same layout-independence trick the typing engine uses (see `inputMode.ts`) — it means a Colemak user hits the same physical keys for navigation as a QWERTY user. The `useKeymap()` hook in `apps/web/src/lib/keymap.ts` is the only place anything subscribes to keydown for shortcuts. Pages should call `useRegisterPageKeymap(title, bindings)` so their bindings show up in the help overlay (`?`).
- **Practice page ↔ keymap interaction is delicate.** The typing handler runs at **capture phase** so it sees keystrokes before any bubble-phase keymap listener. When it consumes a typed character it calls `stopImmediatePropagation`, which prevents the global keymap (or the `g` leader) from re-processing the same key. Modified keys (`Shift+P`, `?` = `Shift+Slash`, etc.) bypass typing entirely — the typing handler returns early when any modifier is held, letting the bubble-phase global keymap take over. **Don't add bare-letter shortcuts to the global keymap** — they'd be eaten by typing on the practice page. Use `Shift+letter`, `g <letter>` (the leader, which works on every other page), or non-alpha keys like `?`, `Esc`, `Tab`, `\`.
- **The `g` nav leader is implemented in `KeymapProvider`.** Pressing `g` (KeyG) outside the practice typing surface arms the leader for 1.5s; the next keypress is captured at document capture phase and routed to the matching page (`p`/`d`/`l`/`f`/`o`/`s`). It explicitly calls `stopImmediatePropagation` so the second key doesn't double-fire as a page binding (e.g. `g j` on `/layouts` doesn't navigate the layout list). On the practice page the leader effectively can't arm because typing eats `g` first — that's intentional. The Shift-prefixed shortcuts (`Shift+P`, etc.) work everywhere as a fallback.
- **`apps/server/dist/` is a build artifact** but is not gitignored at the time of this writing — leave it alone unless you're cleaning up.
- **PRs auto-merge once CI is green.** `.github/workflows/ci.yml` runs build + test on every PR push and has an `enqueue` job that calls `gh pr merge --auto --merge --delete-branch`. GitHub merges the PR (or runs it through the merge queue if configured) as soon as required checks pass. There is no AI review step — the human-in-the-loop gate is the per-commit "Want me to commit and push this?" ask in the parallel protocol. **Do not run `gh pr merge` yourself** — it's automatic.
- **Pull merged work into your main checkout** with `scripts/devin-pull.sh` — it does `git pull origin main --ff-only`, refuses if the current branch isn't `main`, and refuses if the working tree is dirty.
- **Always work in a git worktree under `../worktrees/<slug>/`, never the main checkout.** `git switch` is global to a working tree, so two Devin instances in the same directory will flip each other's branch underneath them and commits will land on the wrong slug. `scripts/devin-spawn.sh <slug>` creates the worktree; `scripts/devin-locks.sh claim` will refuse a second claim from the same `pwd` as a backstop.
- **The lock file is keyed by `basename(git rev-parse --show-toplevel)`, which differs between worktrees and the main checkout.** A command run from cwd `/Users/.../typsy` writes to `~/.devin-locks/typsy.json`; the same command from cwd `/Users/.../worktrees/<slug>/` writes to `~/.devin-locks/<slug>.json`. Always run `claim` AND `release` from the SAME cwd (your worktree, as `scripts/devin-spawn.sh` instructs). A `release` from a different cwd silently no-ops with `(no claim for '<slug>')` and the original claim sits forever in the other file. If you suspect this happened, run `cat ~/.devin-locks/*.json` to find the stranded claim and re-`release` from the matching cwd.
- **`.pnpm-store/` at the repo root** is from a previous local install; it's gitignored and safe to delete if you want to free space.
- **No services need to be running.** No Postgres, no Redis, no message queue. SQLite is the entire backing store and `getDb()` creates it on demand.
- **Production deploy contract.** The app ships as a single Express process: `cd apps/server && PORT=3001 NODE_ENV=production node dist/index.js`. For that to work the build must produce three things: `packages/shared/dist/` (raw `node` can't load `.ts`), `apps/server/dist/db/migrations/*.sql` (the server's `build` script `cp -R`s them — `tsc` doesn't), and `apps/web/dist/index.html` (the SPA fallback target). `pnpm install` builds the `better-sqlite3` native binding because the root `package.json` declares `pnpm.onlyBuiltDependencies` (pnpm v10+ blocks postinstall scripts by default — without that allowlist `pnpm install` silently skips the build and `node dist/index.js` crashes with "Could not locate the bindings file"). The deployed instance lives at `https://typsy.cal.taxi`, fronted by a Cloudflare tunnel on the same host that serves `ssh.cal.taxi`/`3000.cal.taxi`/`1048.cal.taxi`. **Host:** `minmus`, accessed as `natha@minmus`. **Repo path:** `/home/natha/Programming/typsy/` (the systemd unit's `WorkingDirectory=/home/natha/Programming/typsy/apps/server`, `ExecStart=/usr/bin/node dist/index.js`, `User=natha`). systemd unit: `/etc/systemd/system/typsy.service`. Tunnel config: `/etc/cloudflared/config.yml` (sudo) — its `ingress` list maps `typsy.cal.taxi → http://localhost:3001`. Production needs an `apps/server/.env` next to the systemd unit's WorkingDirectory (or env vars set on the unit's `Environment=` lines) — see `apps/server/.env.example`. **`BYPASS_AUTH` MUST NOT be set in production.** **Deploys are manual** — CI auto-merges PRs to `main` but does not redeploy. To ship a merged change: `ssh natha@minmus 'cd /home/natha/Programming/typsy && git pull --ff-only origin main && pnpm build && sudo systemctl restart typsy'`. See `RUNBOOK.md` → "Deploying to production" for the full checklist + verification steps.
- **Auth model.** Every `/api/*` route is gated by Firebase ID token verification (`apps/server/src/auth.ts`). The pre-auth real user (`id=1`, with all your historical sessions/ngrams) is preserved by the auto-link: when the UID configured in `TYPSY_OWNER_FIREBASE_UID` signs in for the first time, the middleware stamps that UID onto row 1. Other Google accounts that sign in get a fresh `INSERT INTO users` and their own user_id. `users.firebase_uid` is `UNIQUE`, so collisions are caught at the DB level. A bypass mode (`BYPASS_AUTH=1` server + `VITE_BYPASS_AUTH=1` web) skips Firebase entirely and falls back to the legacy real/synthetic switch — but both flags must be set together.

---

## How to verify a change works

After any code change, run the relevant subset below before declaring the task done. **The first failure stops the run** — fix it before moving on.

```bash
# 1. Typecheck + build everything (catches ESM extension mistakes, missing exports)
pnpm build

# 2. Run all tests
pnpm test

# 3. If you touched apps/server/, confirm the server still boots and migrations
#    apply on a fresh DB:
rm -f apps/server/data/typsy.db*
pnpm --filter server dev   # watch the log for "[migrations] applied 001_initial.sql"
                            # then "[migrations] applied 002_main_layout.sql"
                            # then "[migrations] applied 003_user_fingering.sql"
                            # then "Server running on http://localhost:3001"
# Ctrl-C once you see the running line.

# 4. If you touched apps/web/, do a manual smoke test:
pnpm dev
# open http://localhost:5173, complete onboarding (3 steps:
# QWERTY = daily driver, Colemak = learn, default fingering — or
# skip the learn step entirely with the "Skip" button), type a few
# characters on /practice, confirm green-on-correct / red-on-wrong,
# and that POST /api/sessions and POST /api/ngrams/batch fire
# (Network tab in DevTools).

# 5. If you touched anything that reads from ngram_stats (drill, flow, dashboard,
#    optimizer), seed synthetic data and visually verify the page renders:
pnpm --filter server seed:dev Colemak
# then visit /dashboard and /optimize.
```

If the test runner reports failures unrelated to your change (e.g. flaky annealing
test), STOP and report — don't paper over breakage that exists on `main`.
