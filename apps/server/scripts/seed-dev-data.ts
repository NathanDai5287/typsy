/**
 * Dev-only: synthesize ngram stats and sessions for ONE layout so the
 * `/optimize` 50k-char threshold opens and the dashboard has data to render.
 *
 * Non-destructive: writes EVERYTHING under the synthetic user (id=2). Real
 * user data (id=1) is never touched, so you can flip back to real data by
 * starting the dev server without TYPSY_DATA_MODE=synthetic. To view what
 * this script writes, run `pnpm dev:synth` (which sets the env var and
 * starts the dev server).
 *
 * Behavior
 *   - Per-layout. Other layouts on the synthetic user are not touched.
 *   - Regenerative. Every run wipes the synthetic user's existing sessions +
 *     ngram_stats for the target layout and writes fresh data. Re-running
 *     gives the same shape, not stacked rows.
 *   - Sets the seeded layout as the synthetic user's active layout so
 *     /practice and /optimize immediately show it after `pnpm dev:synth`.
 *
 * Usage
 *   pnpm --filter server seed:dev                  # Colemak, 100k chars
 *   pnpm --filter server seed:dev Graphite         # named layout
 *   pnpm --filter server seed:dev Colemak 200000   # custom target
 */

import { getDb } from '../src/db/client.js';
import { SYNTHETIC_USER_ID } from '../src/db/dataMode.js';
import {
  ALL_WORDS,
  WORD_RAW,
  pickInitialSubset,
  type Layout,
  type KeyPosition,
  type User,
  type UserLayoutProgress,
  type UserSettings,
} from '@typsy/shared';

const DEFAULT_LAYOUT = 'Colemak';
const DEFAULT_TARGET_CHARS = 100_000;
const NUM_SESSIONS = 20;
const BASELINE_MISS_RATE = 0.04;
const MEAN_KEYPRESS_MS = 200; // ~60 WPM at 5 chars/word

/**
 * A handful of bigrams to give artificially elevated miss rates so the
 * optimizer's per-user weighting has visible signal. Edit at will.
 */
const SYNTHETIC_WEAK_BIGRAMS: { ngram: string; missRate: number }[] = [
  { ngram: 'sc', missRate: 0.35 },
  { ngram: 'rl', missRate: 0.30 },
  { ngram: 'br', missRate: 0.28 },
  { ngram: 'pt', missRate: 0.25 },
  { ngram: 'gh', missRate: 0.22 },
];

interface Stats {
  hits: number;
  misses: number;
  totalTimeMs: number;
}

function bumpStats(map: Map<string, Stats>, key: string, attempts: number, missRate: number) {
  if (attempts <= 0) return;
  const misses = Math.round(attempts * missRate);
  const hits = attempts - misses;
  const existing = map.get(key);
  if (existing) {
    existing.hits += hits;
    existing.misses += misses;
    existing.totalTimeMs += hits * MEAN_KEYPRESS_MS;
  } else {
    map.set(key, { hits, misses, totalTimeMs: hits * MEAN_KEYPRESS_MS });
  }
}

function everyCharInSet(s: string, set: ReadonlySet<string>): boolean {
  for (const c of s) if (!set.has(c)) return false;
  return true;
}

function main(): void {
  const layoutName = process.argv[2] ?? DEFAULT_LAYOUT;
  const targetChars = process.argv[3] ? Number(process.argv[3]) : DEFAULT_TARGET_CHARS;

  if (!Number.isFinite(targetChars) || targetChars <= 0) {
    console.error(`Invalid char target: ${process.argv[3]}. Must be a positive number.`);
    process.exit(1);
  }

  const db = getDb();

  const layout = db
    .prepare('SELECT * FROM layouts WHERE name = ?')
    .get(layoutName) as Layout | undefined;
  if (!layout) {
    console.error(`Layout "${layoutName}" not found. Available:`);
    const all = db.prepare('SELECT name FROM layouts').all() as { name: string }[];
    for (const l of all) console.error(`  - ${l.name}`);
    process.exit(1);
  }

  const positions = JSON.parse(layout.key_positions_json) as KeyPosition[];
  const layoutChars = new Set(
    positions.filter((p) => /^[a-z]$/.test(p.char)).map((p) => p.char),
  );
  const weakBigrams = new Map(SYNTHETIC_WEAK_BIGRAMS.map((w) => [w.ngram, w.missRate]));

  // Compute scale factor so the synthesized total chars ≈ targetChars.
  let totalWeightedChars = 0;
  for (const word of ALL_WORDS) {
    if (!everyCharInSet(word, layoutChars)) continue;
    const count = WORD_RAW.get(word) ?? 0;
    totalWeightedChars += word.length * count;
  }
  if (totalWeightedChars <= 0) {
    console.error(`No words from the bundled list use only chars on layout "${layoutName}".`);
    process.exit(1);
  }
  const scale = targetChars / totalWeightedChars;

  const charStats = new Map<string, Stats>();
  const bigramStats = new Map<string, Stats>();
  const trigramStats = new Map<string, Stats>();
  const wordStats = new Map<string, Stats>();

  for (const word of ALL_WORDS) {
    if (!everyCharInSet(word, layoutChars)) continue;
    const count = WORD_RAW.get(word) ?? 0;
    const attempts = Math.max(1, Math.round(count * scale));

    for (const c of word) bumpStats(charStats, c, attempts, BASELINE_MISS_RATE);

    for (let i = 0; i < word.length - 1; i++) {
      const bigram = word.slice(i, i + 2);
      const missRate = weakBigrams.get(bigram) ?? BASELINE_MISS_RATE;
      bumpStats(bigramStats, bigram, attempts, missRate);
    }

    for (let i = 0; i < word.length - 2; i++) {
      const trigram = word.slice(i, i + 3);
      bumpStats(trigramStats, trigram, attempts, BASELINE_MISS_RATE);
    }

    bumpStats(wordStats, word, attempts, BASELINE_MISS_RATE);
  }

  // Belt-and-suspenders: ensure the synthetic user row exists. seed.ts
  // already inserts it on every server boot, but seed:dev may run against a
  // never-booted DB.
  db.prepare('INSERT OR IGNORE INTO users (id) VALUES (?)').run(SYNTHETIC_USER_ID);

  const tx = db.transaction(() => {
    // Wipe existing synthetic-user data for this layout. Real user (id=1)
    // rows are never touched.
    const ng = db
      .prepare('DELETE FROM ngram_stats WHERE user_id = ? AND layout_id = ?')
      .run(SYNTHETIC_USER_ID, layout.id);
    const ss = db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND layout_id = ?')
      .run(SYNTHETIC_USER_ID, layout.id);

    const insertNgram = db.prepare(
      `INSERT INTO ngram_stats
         (user_id, layout_id, ngram, ngram_type, hits, misses, total_time_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const bulkInsert = (map: Map<string, Stats>, type: string) => {
      for (const [ngram, s] of map) {
        insertNgram.run(
          SYNTHETIC_USER_ID,
          layout.id,
          ngram,
          type,
          s.hits,
          s.misses,
          s.totalTimeMs,
        );
      }
    };
    bulkInsert(charStats, 'char1');
    bulkInsert(bigramStats, 'char2');
    bulkInsert(trigramStats, 'char3');
    bulkInsert(wordStats, 'word1');

    // Total chars / errors from char1 stats — these are the true totals.
    let totalChars = 0;
    let totalErrors = 0;
    for (const s of charStats.values()) {
      totalChars += s.hits + s.misses;
      totalErrors += s.misses;
    }
    const charsPerSession = Math.floor(totalChars / NUM_SESSIONS);
    const errorsPerSession = Math.floor(totalErrors / NUM_SESSIONS);

    // Synthetic sessions: spread across the past N days so the time-series
    // chart has something to render. Slowly improving WPM + accuracy.
    const insertSession = db.prepare(
      `INSERT INTO sessions
         (user_id, layout_id, started_at, ended_at, mode, wpm, accuracy,
          chars_typed, errors, cumulative_chars_at_session_end)
       VALUES (?, ?, ?, ?, 'seed', ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    let cumulative = 0;
    for (let i = 0; i < NUM_SESSIONS; i++) {
      const dayOffset = NUM_SESSIONS - 1 - i;
      const started = new Date(now - dayOffset * 24 * 60 * 60 * 1000);
      const ended = new Date(started.getTime() + 5 * 60 * 1000);
      const wpm = 50 + (i / NUM_SESSIONS) * 30 + (Math.random() - 0.5) * 5;
      const accuracy = 0.92 + (i / NUM_SESSIONS) * 0.05 + (Math.random() - 0.5) * 0.02;
      cumulative += charsPerSession;
      insertSession.run(
        SYNTHETIC_USER_ID,
        layout.id,
        started.toISOString(),
        ended.toISOString(),
        Math.round(wpm * 10) / 10,
        Math.round(Math.min(0.999, Math.max(0.5, accuracy)) * 1000) / 1000,
        charsPerSession,
        errorsPerSession,
        cumulative,
      );
    }

    // Make sure user_layout_progress row exists for the synthetic user
    // (creates one with the standard initial subset if not).
    const existing = db
      .prepare(
        'SELECT * FROM user_layout_progress WHERE user_id = ? AND layout_id = ?',
      )
      .get(SYNTHETIC_USER_ID, layout.id) as UserLayoutProgress | undefined;

    if (!existing) {
      const initialUnlocked = pickInitialSubset(positions);
      db.prepare(
        `INSERT INTO user_layout_progress
           (user_id, layout_id, unlocked_keys_json,
            current_mode, last_session_at)
         VALUES (?, ?, ?, 'flow', ?)`,
      ).run(
        SYNTHETIC_USER_ID,
        layout.id,
        JSON.stringify(initialUnlocked),
        new Date(now).toISOString(),
      );
    } else {
      db.prepare(
        `UPDATE user_layout_progress SET last_session_at = ?
         WHERE user_id = ? AND layout_id = ?`,
      ).run(new Date(now).toISOString(), SYNTHETIC_USER_ID, layout.id);
    }

    // Set the synthetic user's active layout — does NOT touch the real
    // user's settings, so flipping back to real mode lands on whatever
    // layout was last active there.
    const user = db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(SYNTHETIC_USER_ID) as User;
    let settings: UserSettings = {};
    try {
      settings = JSON.parse(user.settings_json) as UserSettings;
    } catch {
      // ignore
    }
    settings.active_layout_id = layout.id;
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(
      JSON.stringify(settings),
      SYNTHETIC_USER_ID,
    );

    // Print summary
    console.log(`\n  Wiped ${ng.changes} ngram_stats and ${ss.changes} sessions for "${layoutName}" (synthetic user)`);
    console.log(`  Inserted ngrams: char1=${charStats.size}, char2=${bigramStats.size}, char3=${trigramStats.size}, word1=${wordStats.size}`);
    console.log(`  Inserted ${NUM_SESSIONS} sessions covering ${totalChars.toLocaleString()} chars (errors ${totalErrors.toLocaleString()})`);
    console.log(`  Active layout set to "${layoutName}" (id=${layout.id}) for the synthetic user`);
    console.log(`\n  All writes are scoped to user_id=${SYNTHETIC_USER_ID}. Real data (user_id=1) is untouched.`);
    console.log(`  To view: run \`pnpm dev:synth\` (or set TYPSY_DATA_MODE=synthetic before \`pnpm dev\`).`);
    console.log(`\n  Synthetic weak bigrams (artificial elevated miss rate, useful for the optimizer):`);
    for (const w of SYNTHETIC_WEAK_BIGRAMS) {
      console.log(`    ${w.ngram}  →  ${(w.missRate * 100).toFixed(0)}% miss`);
    }
    console.log();
  });

  tx();
}

main();
