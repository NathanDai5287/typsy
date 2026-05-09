/**
 * One-time helper: wipe ngram_stats and bigram_word_misses for a given user.
 *
 * Use after a tracker change that invalidates historical data (e.g. the
 * phantom-doubled-bigram fix), so the dashboard reflects only post-fix data.
 *
 * Usage
 *   pnpm --filter server wipe:ngrams              # user_id=1 (real)
 *   pnpm --filter server wipe:ngrams 2            # user_id=2 (synthetic)
 *   pnpm --filter server wipe:ngrams 1 5          # user_id=1, layout_id=5 only
 *
 * Run on the production host as:
 *   ssh natha@minmus 'cd /home/natha/Programming/typsy && pnpm --filter server wipe:ngrams'
 *
 * Sessions are NOT touched — wpm/accuracy history stays. Only per-bigram
 * counters reset.
 */

import { getDb } from '../src/db/client.js';

const userId = Number(process.argv[2] ?? 1);
const layoutId = process.argv[3] ? Number(process.argv[3]) : null;

if (!Number.isFinite(userId)) {
  console.error('Usage: wipe-ngrams.ts <user_id> [layout_id]');
  process.exit(1);
}

const db = getDb();

const ngramSql = layoutId
  ? 'DELETE FROM ngram_stats WHERE user_id = ? AND layout_id = ?'
  : 'DELETE FROM ngram_stats WHERE user_id = ?';
const bwmSql = layoutId
  ? 'DELETE FROM bigram_word_misses WHERE user_id = ? AND layout_id = ?'
  : 'DELETE FROM bigram_word_misses WHERE user_id = ?';

const args = layoutId ? [userId, layoutId] : [userId];

const result = db.transaction(() => {
  const ngramRes = db.prepare(ngramSql).run(...args);
  const bwmRes = db.prepare(bwmSql).run(...args);
  return { ngram: ngramRes.changes, bwm: bwmRes.changes };
})();

console.log(
  `Wiped ${result.ngram} ngram_stats rows and ${result.bwm} bigram_word_misses rows for user_id=${userId}` +
    (layoutId ? `, layout_id=${layoutId}` : ''),
);
