# Development

Day-to-day commands for working on Typsy.

## Common commands

```bash
pnpm dev                         # web (5173) + server (3001), hot reload
pnpm build                       # typecheck + build everything
pnpm test                        # run all package tests

pnpm --filter web dev            # web only
pnpm --filter server dev         # server only
pnpm --filter @typsy/shared test # shared package tests only
pnpm --filter web test           # web tests only
```

## Seeding synthetic data for the optimizer

`/optimize` is gated until you've typed `OPTIMIZER_MIN_CHARS` (50,000) on the
active layout. To test it without typing that much:

```bash
pnpm --filter server seed:dev                  # Colemak, 100k chars (default)
pnpm --filter server seed:dev Colemak          # explicit layout
pnpm --filter server seed:dev Graphite         # different layout, 100k chars
pnpm --filter server seed:dev Colemak 200000   # custom char target
```

### Behavior

- **Per-layout.** Only touches the target layout's data; other layouts are
  unaffected.
- **Regenerative.** Each run wipes the target layout's existing sessions and
  ngram_stats and writes fresh synthetic data. Re-run any time — you always
  end up with the same shape, not stacked rows.
- **Active layout switches** to whatever you just seeded, so `/practice`,
  `/dashboard`, and `/optimize` immediately show it.
- **Synthetic weak bigrams** (`sc`, `rl`, `br`, `pt`, `gh`) get artificially
  elevated miss rates (22–35 %) so the optimizer's per-user weighting has
  visible signal in its suggestions.

### After seeding

`tsx watch` usually picks up source changes automatically, but a long-running
better-sqlite3 connection may cache and not see the new ngram rows. If the
dashboard / optimize page looks stale after a seed, restart the dev server:

```bash
# in the terminal running `pnpm dev`
Ctrl-C
pnpm dev
```

## Resetting the database

The seed script wipes data **per layout**. To wipe everything (including the
single user record, all layouts other than seeded ones, all sessions, all
stats), nuke the SQLite file:

```bash
rm apps/server/data/typsy.db*
```

The next `pnpm dev` (or `seed:dev`) re-creates the DB from scratch via
migrations + the layout seeder (QWERTY, Colemak, Graphite).

> ⚠️ This deletes any real practice sessions you've recorded. If you want to
> wipe just one layout, run `seed:dev <layout>` — that only wipes that
> layout's data.

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
