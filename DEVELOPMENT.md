# Development

Day-to-day commands for working on Typsy.

## Common commands

```bash
pnpm dev                         # web (5173) + server (3001), hot reload (local DB)
pnpm dev --db=staging            # explicit form of the above
pnpm dev --db=prod               # web only, talks to the production server's DB
pnpm dev:synth                   # seed synthetic data + run dev in synthetic mode
pnpm build                       # typecheck + build everything
pnpm test                        # run all package tests

pnpm --filter web dev            # web only
pnpm --filter server dev         # server only
pnpm --filter @typsy/shared test # shared package tests only
pnpm --filter web test           # web tests only
```

## Local vs. production database (`pnpm dev --db=...`)

`pnpm dev` accepts a `--db` flag that picks which SQLite the local web app
talks to. Both modes always run `vite` on `http://localhost:5173`; the only
thing that changes is what's behind `/api`.

| Mode | What runs locally | What `/api` hits | Where writes land |
|---|---|---|---|
| `--db=staging` (default) | `tsc -w` for `@typsy/shared` + `tsx watch` for `apps/server` (port 3001) + `vite` for `apps/web` (port 5173) | the local server on port 3001 | `apps/server/data/typsy.db` (gitignored, local file) |
| `--db=prod` | `ssh -N -L 3001:localhost:3001 natha@ssh.cal.taxi` (tunnel) + `tsc -w` for `@typsy/shared` + `vite` for `apps/web` (port 5173) | the production server through the SSH tunnel | `/home/natha/typsy/apps/server/data/typsy.db` on the Ubuntu box (the same DB `https://typsy.cal.taxi` reads/writes) |

### `pnpm dev` (a.k.a. `pnpm dev --db=staging`)

Standard local dev. Three concurrent processes — shared (tsc-watch),
server (tsx-watch on 3001), web (vite on 5173) — all hot-reloading from
source. Vite proxies `/api` to `http://localhost:3001`. Reads/writes go
to your local SQLite at `apps/server/data/typsy.db`. Production data is
untouched. **Use this for normal feature work.**

### `pnpm dev --db=prod`

Skips the local server entirely. Instead, opens an SSH tunnel that maps
your Mac's `localhost:3001` to the Ubuntu server's `localhost:3001`
(where `typsy.service` is listening). Vite's existing `/api` →
`localhost:3001` proxy now lands at the production process, which
reads/writes the production SQLite. Every API call from your local
browser is a real production write, exactly as if you'd loaded
`https://typsy.cal.taxi` directly — but with hot-reloading frontend
code so you can iterate on UI without redeploying.

Things to know:

- **It is the production DB.** There is no copy-on-write, no scratch
  branch, no undo. Sessions, ngrams, layout swaps you make in this mode
  are real. Treat it like editing prod by hand.
- **Frontend changes are local-only.** UI tweaks live in your `pnpm dev`
  process; they don't deploy. To put them on `https://typsy.cal.taxi`
  you still have to commit, push, redeploy.
- **Backend changes will be missing.** If you edit `apps/server/` or
  `packages/shared/` while in `--db=prod` mode, your local web sees the
  new shared types but the server it's talking to is still running the
  deployed code. Schema changes in particular will look broken — the
  remote server has no idea about your new migration. Switch back to
  `--db=staging` for any server-side work.
- **No local server is running.** Port 3001 on your Mac is the SSH
  tunnel for as long as the script runs. Closing it (Ctrl-C) tears down
  both the tunnel and Vite; nothing is left bound. If you want to use
  the local server again afterwards, run `pnpm dev` again (no flag).
- **Auth.** There's none yet. Anyone who can reach
  `https://typsy.cal.taxi` can read/write the same DB. The tunnel
  doesn't add any protection beyond what Cloudflare already provides
  on the public hostname.

### `pnpm dev:synth`

Same as `--db=staging` but seeds the synthetic user (`user_id=2`) with
a fresh batch of fake ngrams + sessions and starts the server with
`TYPSY_DATA_MODE=synthetic` so every read/write hits `user_id=2`. Real
practice data on `user_id=1` is untouched. See the next section.

## Synthetic data (non-destructive, dev-only)

The DB holds two parallel users: `user_id=1` (your real practice data) and
`user_id=2` (synthetic data). Which one the server reads/writes is decided
by the `TYPSY_DATA_MODE` env var at startup:

| Env | User the server acts as | Use case |
|---|---|---|
| _unset_ or `real` | `user_id=1` | Normal practice |
| `synthetic` | `user_id=2` | Demo/test data from `seed:dev` |

The two are completely isolated — sessions, ngram_stats, unlocked keys,
fingering, active layout — nothing crosses between them. Switching is just
restarting the server with a different env.

### Single-command synthetic mode

```bash
pnpm dev:synth   # runs seed:dev (Colemak/100k) → starts dev server in synthetic mode
```

That's it. Dashboard/optimize/practice immediately show the synthetic data.
Your real data is untouched.

### Switching back to real data

```bash
# stop the dev server (Ctrl-C in the dev terminal), then:
pnpm dev
```

Real `user_id=1` data is exactly as you left it.

### Customizing the seed

`seed:dev` writes fresh data each run (regenerative — same shape, not stacked
rows) but ONLY for the synthetic user. Real data is never touched.

```bash
pnpm --filter server seed:dev                  # Colemak, 100k chars (default)
pnpm --filter server seed:dev Graphite         # different layout, 100k chars
pnpm --filter server seed:dev Colemak 200000   # custom char target
```

After running this manually, follow up with `TYPSY_DATA_MODE=synthetic pnpm dev`
to view it (or just use `pnpm dev:synth` which does both in one go and uses
the defaults).

### What the synthetic data looks like

- **Per-layout.** Only the target layout's synthetic-user rows are touched
  on each seed run; other layouts on the synthetic user, and all real-user
  layouts, are unaffected.
- **Active layout switches** for the synthetic user to whatever you just
  seeded, so `/practice`, `/dashboard`, and `/optimize` immediately show it
  in synthetic mode. The real user's active layout is untouched.
- **Synthetic weak bigrams** (`sc`, `rl`, `br`, `pt`, `gh`) get artificially
  elevated miss rates (22–35 %) so the optimizer's per-user weighting has
  visible signal in its suggestions.

### After seeding

`tsx watch` usually picks up source changes automatically, but a long-running
better-sqlite3 connection may cache and not see the new ngram rows. If the
dashboard / optimize page looks stale after a seed, restart the dev server:

```bash
# in the terminal running pnpm dev / pnpm dev:synth
Ctrl-C
pnpm dev:synth   # or pnpm dev
```

## Resetting the database

`seed:dev` only wipes the synthetic user's data for one layout. To wipe
EVERYTHING (real + synthetic, all layouts, all sessions, all stats), nuke
the SQLite file:

```bash
rm apps/server/data/typsy.db*
```

The next `pnpm dev` (or `seed:dev`) re-creates the DB from scratch via
migrations + the layout seeder (QWERTY, Colemak, Graphite) and re-creates
both users.

> ⚠️ This deletes your real practice sessions too. If you only want to
> regenerate synthetic data, just re-run `pnpm --filter server seed:dev` —
> that only touches the synthetic user, never the real one.

## Where things live

```
apps/server/data/typsy.db        SQLite DB (gitignored)
apps/server/src/db/migrations/   *.sql files, applied in lex order at startup
apps/server/src/db/client.ts     migration runner (tracked via _migrations)
apps/server/scripts/             dev-only scripts (seed-dev-data.ts)
apps/web/src/                    React app
packages/shared/src/             pure-function library (algorithms, types)
```

## Tuning constants

Most knobs live in `packages/shared/src/constants.ts`:

```
UNLOCK_WPM            = 30      # progressive-unlock WPM threshold
UNLOCK_ACCURACY       = 0.95    # progressive-unlock accuracy threshold
REVIEW_THRESHOLD      = 0.85    # accuracy below this re-surfaces a key
BAYESIAN_ALPHA / BETA = 1 / 9   # Beta(1,9) prior on error rate
MIN_NGRAM_SAMPLES     = 10      # backoff threshold
INITIAL_SUBSET_SIZE   = 4       # # of home-row keys you start with
OPTIMIZER_MIN_CHARS   = 50_000  # gate on /optimize
WRITE_FLUSH_INTERVAL_MS = 30_000
```

Lower `OPTIMIZER_MIN_CHARS` temporarily if you want to test the gate without
running the seed script.

## Adding a migration

1. Drop a new `NNN_description.sql` file in
   `apps/server/src/db/migrations/` (use the next number).
2. Restart the server. The runner applies any unrun migrations in lexical
   order, recording each one in the `_migrations` table.
3. Migrations are wrapped in a transaction so partial application is
   impossible.

The runner is idempotent and safe to re-run; existing DBs only see new files.
