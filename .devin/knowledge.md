# Typsy — Project Knowledge

A keyboard-navigable web app for learning new keyboard layouts (QWERTY, Colemak, Graphite, plus user-created layouts). Single-user, local-first, SQLite-backed.

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
- **Entry point:** <ref_file file="/Users/natha/Programming/typsy/apps/server/src/index.ts" /> — boots Express on port 3001, mounts four routers, calls `getDb()` to run migrations + seed.
- `src/db/client.ts` — `getDb()` opens `apps/server/data/typsy.db`, applies any new `*.sql` files in `migrations/` (in lexical order, tracked via `_migrations` table), then runs `seedData()`.
- `src/db/migrations/*.sql` — schema migrations. `001_initial.sql` defines `users`, `layouts`, `user_layout_progress`, `sessions`, `ngram_stats`. `002_main_layout.sql` adds `is_main_layout` flag. `003_user_fingering.sql` moves fingerings off `user_layout_progress` (where they were char-keyed and per-layout) onto `users.fingering_map_json` (position-keyed `"row,col"` → `FingerLabel`, layout-independent).
- `src/db/seed.ts` — inserts the three built-in layouts plus two users: `id=1` (real) and `id=2` (synthetic). The schema already keys every per-user table by `user_id`, so the two are fully isolated.
- `src/db/dataMode.ts` — dev-only switch. `getCurrentUserId()` reads `process.env.TYPSY_DATA_MODE` ('synthetic' → `id=2`, else → `id=1`). Routes call this once per request and use the result everywhere they used to hardcode `user_id = 1`. The mode is set at server startup; switching means restarting the dev server with a different env. Intentionally invisible to the UI.
- `src/routes/{user,layouts,sessions,ngrams}.ts` — Express routers under `/api/user`, `/api/layouts`, `/api/sessions`, `/api/ngrams`. All routes pull the active `user_id` from `getCurrentUserId()` (no auth — single human user, but two DB users for the real/synthetic split).
- `scripts/seed-dev-data.ts` — dev-only synthetic data generator for the optimizer gate. **Non-destructive** — only ever wipes/writes `user_id=2` rows; real `user_id=1` data is untouched.
- DB file: `apps/server/data/typsy.db` (gitignored). Created automatically on first server boot.

### `apps/web/` — Vite + React 18 + Tailwind (TypeScript, ESM)
- **Entry point:** <ref_file file="/Users/natha/Programming/typsy/apps/web/src/main.tsx" /> — wraps `<App>` in `BrowserRouter` + `QueryClientProvider`.
- `src/App.tsx` — fetches the user once via TanStack Query; redirects to `/onboarding` if no `layout_progress`. All routes mounted here.
- `src/pages/` — one `*Page.tsx` per route: `Onboarding`, `Practice`, `Dashboard`, `Optimize`, `Layouts`, `Fingering`, `Settings`.
- `src/components/` — `Nav.tsx` (top nav, hidden during onboarding), `KeyboardVisual.tsx` (on-screen keyboard with finger colors + opacity-fade for muscle memory), and `FingeringEditor.tsx` (reusable click-key-pick-finger editor used in onboarding and on `/fingering`).
- `src/lib/api.ts` — typed fetch wrappers around every `/api/*` endpoint. **All HTTP goes through here.**
- `src/lib/ngramTracker.ts` — buffers char/word ngram deltas in memory, flushes every 30s and on session end via `POST /api/ngrams/batch`.
- `src/lib/finger-colors.ts` — finger → Tailwind color mapping (Catppuccin Mocha palette).
- Vite proxies `/api` → `http://localhost:3001` (see `vite.config.ts`).

### `packages/shared/` — Pure logic, no I/O (TypeScript, ESM)
- Single barrel export at `src/index.ts`. Every consumer imports from `@typsy/shared`.
- **No file in this package may read from disk, hit the network, or use globals other than `Math.random`** (which is injectable as `rng`). Everything is unit-testable in vitest with `environment: 'node'`.
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

# Dev (web on 5173 + server on 3001 with hot reload)
pnpm dev

# Build (typecheck both apps + emit server dist + emit web dist)
pnpm build

# Test (all packages)
pnpm test

# Per-package
pnpm --filter web dev
pnpm --filter server dev
pnpm --filter web test
pnpm --filter server test
pnpm --filter @typsy/shared test
pnpm --filter web build      # tsc && vite build
pnpm --filter server build   # tsc → apps/server/dist/

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
| Layout | Append a new `LayoutGrid` to `packages/shared/src/layouts.ts` and add it to `LAYOUT_DEFINITIONS`. The seed script picks it up on next boot. Built-in layouts cannot be deleted via `DELETE /api/layouts/:id` (see `SEEDED_NAMES` in `apps/server/src/routes/layouts.ts`). | `Graphite` block in `packages/shared/src/layouts.ts` |
| Tunable constant | Add to `packages/shared/src/constants.ts` and consume from `@typsy/shared`. | `OPTIMIZER_MIN_CHARS` |

---

## Where to find X

### Frontend pages and routes
| Concern | Path |
|---|---|
| Route table | `apps/web/src/App.tsx` |
| Practice page (typing loop, mode toggle, keyboard) | `apps/web/src/pages/PracticePage.tsx` |
| Dashboard (charts, heatmaps, top-N weak ngrams) | `apps/web/src/pages/DashboardPage.tsx` |
| Onboarding (layout pick + fingering assignment) | `apps/web/src/pages/OnboardingPage.tsx` |
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
| Layout grid definitions (QWERTY/Colemak/Graphite) + builders + `posKey()` (canonical `"row,col"` key for position-based maps) | `packages/shared/src/layouts.ts` |
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
- **Auth.** Single human user, no login. The schema has two DB users (`id=1` real, `id=2` synthetic) for the data-mode split — `getCurrentUserId()` in `apps/server/src/db/dataMode.ts` decides which one each request reads/writes based on `TYPSY_DATA_MODE`. Treat this as one human with two parallel data tracks, NOT a multi-user system. There are no login routes, no JWTs, no session cookies.
- **Feature flags.** None.
- **Env vars.** Two: `PORT` (server, defaults to 3001) and `TYPSY_DATA_MODE` (server, `'synthetic'` or unset/`'real'`). No `.env` file is needed for local dev.
- **Docker / containers.** Not configured.
- **Lint / format config.** No ESLint, no Prettier. Match existing style by reading the file you're editing.

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
- **The Graphite layout in `packages/shared/src/layouts.ts` is a best-effort placeholder.** See the `TODO` comment there. Not yet validated against the official reference.
- **Built-in layouts (QWERTY/Colemak/Graphite) cannot be deleted.** `SEEDED_NAMES` in `apps/server/src/routes/layouts.ts` enforces this.
- **All pure-function tests must work without a real `Math.random`.** Functions like `generateDrillSequence`, `generateFlowLine`, `runAnnealing` accept an injectable `rng` parameter — use it in tests for determinism.
- **Tailwind theme is custom (Catppuccin Mocha).** Don't introduce ad-hoc hex colors; use the named tokens defined in `apps/web/tailwind.config.js`.
- **`apps/server/dist/` is a build artifact** but is not gitignored at the time of this writing — leave it alone unless you're cleaning up.
- **PRs auto-merge once CI is green.** `.github/workflows/ci.yml` runs build + test on every PR push and has an `enqueue` job that calls `gh pr merge --auto --merge --delete-branch`. GitHub merges the PR (or runs it through the merge queue if configured) as soon as required checks pass. There is no AI review step — the human-in-the-loop gate is the per-commit "Want me to commit and push this?" ask in the parallel protocol. **Do not run `gh pr merge` yourself** — it's automatic.
- **Pull merged work into your main checkout** with `scripts/devin-pull.sh` — it does `git pull origin main --ff-only`, refuses if the current branch isn't `main`, and refuses if the working tree is dirty.
- **Always work in a git worktree under `../worktrees/<slug>/`, never the main checkout.** `git switch` is global to a working tree, so two Devin instances in the same directory will flip each other's branch underneath them and commits will land on the wrong slug. `scripts/devin-spawn.sh <slug>` creates the worktree; `scripts/devin-locks.sh claim` will refuse a second claim from the same `pwd` as a backstop.
- **The lock file is keyed by `basename(git rev-parse --show-toplevel)`, which differs between worktrees and the main checkout.** A command run from cwd `/Users/.../typsy` writes to `~/.devin-locks/typsy.json`; the same command from cwd `/Users/.../worktrees/<slug>/` writes to `~/.devin-locks/<slug>.json`. Always run `claim` AND `release` from the SAME cwd (your worktree, as `scripts/devin-spawn.sh` instructs). A `release` from a different cwd silently no-ops with `(no claim for '<slug>')` and the original claim sits forever in the other file. If you suspect this happened, run `cat ~/.devin-locks/*.json` to find the stranded claim and re-`release` from the matching cwd.
- **`.pnpm-store/` at the repo root** is from a previous local install; it's gitignored and safe to delete if you want to free space.
- **No services need to be running.** No Postgres, no Redis, no message queue. SQLite is the entire backing store and `getDb()` creates it on demand.

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
                            # then "Server running on http://localhost:3001"
# Ctrl-C once you see the running line.

# 4. If you touched apps/web/, do a manual smoke test:
pnpm dev
# open http://localhost:5173, complete onboarding (Colemak, default fingering),
# type a few characters on /practice, confirm green-on-correct / red-on-wrong,
# and that POST /api/sessions and POST /api/ngrams/batch fire
# (Network tab in DevTools).

# 5. If you touched anything that reads from ngram_stats (drill, flow, dashboard,
#    optimizer), seed synthetic data and visually verify the page renders:
pnpm --filter server seed:dev Colemak
# then visit /dashboard and /optimize.
```

If the test runner reports failures unrelated to your change (e.g. flaky annealing
test), STOP and report — don't paper over breakage that exists on `main`.
