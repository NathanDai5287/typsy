> If you are an AI agent, read `.devin/knowledge.md` and `.devin/PARALLEL_PROTOCOL.md` before doing anything.

# Typsy — Keyboard Layout Trainer

A keyboard-navigable web app for learning new keyboard layouts. Currently supports QWERTY, Colemak, and Graphite.

## Setup

```bash
pnpm install
pnpm dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3001

## Architecture

```
/apps/web       — Vite + React 18 + Tailwind CSS (TypeScript)
/apps/server    — Node.js + Express + better-sqlite3 (TypeScript, tsx)
/packages/shared — Shared types, constants, layout definitions, corpus
```

**Data flow:**
1. Server boots → runs `001_initial.sql` migration → seeds 3 layouts + user id=1
2. Frontend loads → checks `GET /api/user` for `layout_progress`
3. If empty → redirects to `/onboarding` (pick layout + assign fingering)
4. Practice page captures `keydown` events at document level
5. `translateKeypress` maps `KeyboardEvent.code` → physical row/col → active layout char
6. `NgramTracker` buffers char/word ngram deltas in memory, flushes every 30s and on session end
7. Session saved via `POST /api/sessions` on completion

**Input mode (hybrid):**
`KeyboardEvent.code` is physical-key-position-independent, so the typing loop works regardless of whether your OS is on QWERTY or the target layout. Physical `KeyF` (QWERTY row 1 col 3) always maps to whatever character sits at row 1 col 3 in the active layout.

**Database:** SQLite at `apps/server/data/typsy.db`
Schema tables: `users`, `layouts`, `user_layout_progress`, `sessions`, `ngram_stats`

## Running tests

```bash
pnpm test
# or per-package:
pnpm --filter @typsy/shared test
pnpm --filter web test
```

## Implemented

- **Phase 0 — Skeleton.** Monorepo, routing, schema, seeded layouts.
- **Phase 1 — MVP.** Onboarding, typing loop, session recording, batched ngram stats.
- **Phase 2 — Adaptive learning.** Bayesian-smoothed error rates with ngram backoff
  (`packages/shared/src/bayesian.ts`, `ngramStats.ts`), initial home-row subset selection
  (`initialSubset.ts`), key unlock / review-resurface (`keyUnlock.ts`), snippet-based
  drill generation that targets the user's weakest bigrams and most-missed words
  (`drill.ts`, with corpus bigram statistics in `markov.ts`), weakness-weighted flow
  generation (`flow.ts`), and a drill/flow mode toggle on the practice page.
- **Phase 3 — Visualization.** On-screen keyboard with finger colors and a
  muscle-memory opacity fade (`apps/web/src/components/KeyboardVisual.tsx`).
  Dashboard with WPM-over-time, WPM-over-volume, accuracy trend, per-finger WPM,
  weakness heatmap, top-10 weak bigrams + words, session history, streak counter,
  total chars typed, and SFB rate. Charts use Recharts.
- **Phase 4 — Layout optimizer.** Difficulty model classifying bigrams as SFB,
  scissor, lateral stretch, long jump, alternation, inward/outward roll, plus
  trigram redirect detection (`packages/shared/src/difficulty.ts`). Cost
  function combines English bigram frequency × difficulty × user miss rate
  (`cost.ts`). Two search strategies: brute-force best-single-swap, and
  simulated annealing over pairwise swaps (`annealing.ts`). The `/optimize`
  page is gated by the 50k-char threshold and shows before/after heatmaps for
  each suggestion; accepting creates a new custom layout entry and switches to
  it.
- **Multi-layout support.** Layouts can be marked as the user's "daily
  driver" (`is_main_layout`) — those layouts skip progressive unlocking and
  treat all alpha keys as already learned. The `/layouts` page lists every
  layout with per-layout WPM, total chars, and session count, and offers
  "Switch to" / "Mark as daily driver" / "Set up" actions. `active_layout_id`
  is persisted in `user.settings_json`.

The English word frequency list (top 10k a-z words) is bundled in
`packages/shared/src/wordListData.ts`, generated from
[Norvig's web-crawl unigram counts](https://norvig.com/ngrams/count_1w.txt) with
single-letter repetitions filtered out.

Database migrations live in `apps/server/src/db/migrations/`; the runner in
`apps/server/src/db/client.ts` applies any new `*.sql` files in lexical order
once each, tracked via the `_migrations` table.

## Next steps (future phases)

- **Phase 5 — Polish & QoL:** full keyboard navigation, hotkey overlay (`?`),
  settings page with thresholds exposed, JSON data export/import,
  custom-layout editor (key-position drag-drop) on `/layouts`, side-by-side
  layout reference. The "Test drive" optimizer flow with a 5-minute trial
  before commit also belongs here.
- **Phase 6 — Stretch:** code mode, prose mode, custom corpus upload,
  GPT-targeted sentences, plateau detection, milestone celebrations.

## Graphite layout note

The Graphite layout definition in `packages/shared/src/layouts.ts` is a best-effort placeholder. Verify against the official reference before relying on it for serious practice.
