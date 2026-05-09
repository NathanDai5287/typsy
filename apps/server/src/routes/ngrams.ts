import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import { requireUserId } from '../auth.js';
import type { BigramWordMiss, NgramBatchPayload, NgramStat } from '@typsy/shared';

const router: ExpressRouter = Router();

router.post('/batch', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const { layout_id, deltas, bigram_word_misses } = req.body as NgramBatchPayload;

  if (
    !layout_id ||
    !Array.isArray(deltas) ||
    (deltas.length === 0 && (!bigram_word_misses || bigram_word_misses.length === 0))
  ) {
    res.status(400).json({ error: 'layout_id and at least one delta or bigram_word_miss are required' });
    return;
  }

  const upsertNgram = db.prepare(
    `INSERT INTO ngram_stats
       (user_id, layout_id, ngram, ngram_type, hits, misses, total_time_ms, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, layout_id, ngram, ngram_type) DO UPDATE SET
       hits = hits + excluded.hits,
       misses = misses + excluded.misses,
       total_time_ms = total_time_ms + excluded.total_time_ms,
       last_seen_at = excluded.last_seen_at`,
  );

  const upsertBigramWordMiss = db.prepare(
    `INSERT INTO bigram_word_misses
       (user_id, layout_id, bigram, target_word, typed_word, miss_count, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, layout_id, bigram, target_word, typed_word) DO UPDATE SET
       miss_count = miss_count + excluded.miss_count,
       last_seen_at = excluded.last_seen_at`,
  );

  const runAll = db.transaction(() => {
    for (const delta of deltas) {
      upsertNgram.run(
        userId,
        layout_id,
        delta.ngram,
        delta.ngram_type,
        delta.hits_delta,
        delta.misses_delta,
        delta.time_delta_ms,
      );
    }
    if (bigram_word_misses) {
      for (const m of bigram_word_misses) {
        if (!m.bigram || !m.target_word || !m.typed_word || !Number.isFinite(m.miss_delta)) continue;
        upsertBigramWordMiss.run(
          userId,
          layout_id,
          m.bigram,
          m.target_word,
          m.typed_word,
          m.miss_delta,
        );
      }
    }
  });

  runAll();

  res.json({ ok: true, count: deltas.length, bigram_word_miss_count: bigram_word_misses?.length ?? 0 });
});

/**
 * GET /api/ngrams/bigram-word-misses?layout_id=X[&bigram=ra]
 *
 * Returns rows from `bigram_word_misses` for the current user + layout,
 * optionally filtered to a single bigram. Caller groups / sorts client-side.
 */
router.get('/bigram-word-misses', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const layoutId = Number(req.query.layout_id);
  const bigram = typeof req.query.bigram === 'string' ? req.query.bigram : undefined;

  if (!Number.isFinite(layoutId)) {
    res.status(400).json({ error: 'layout_id query param is required' });
    return;
  }

  const rows = bigram
    ? (db
        .prepare(
          `SELECT * FROM bigram_word_misses
           WHERE user_id = ? AND layout_id = ? AND bigram = ?
           ORDER BY miss_count DESC`,
        )
        .all(userId, layoutId, bigram) as BigramWordMiss[])
    : (db
        .prepare(
          `SELECT * FROM bigram_word_misses
           WHERE user_id = ? AND layout_id = ?
           ORDER BY miss_count DESC`,
        )
        .all(userId, layoutId) as BigramWordMiss[]);

  res.json(rows);
});

/**
 * GET /api/ngrams/stats?layout_id=X[&type=char1|char2|char3|word1|word2]
 *
 * Returns all ngram stats for the current data-mode user (real or synthetic)
 * and the given layout. Optionally filterable by `type`. The response shape
 * matches the NgramStat[] type used by the @typsy/shared backoff/lookup
 * utilities.
 */
router.get('/stats', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const layoutId = Number(req.query.layout_id);
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;

  if (!Number.isFinite(layoutId)) {
    res.status(400).json({ error: 'layout_id query param is required' });
    return;
  }

  const allowedTypes = ['char1', 'char2', 'char3', 'word1', 'word2'];
  if (type !== undefined && !allowedTypes.includes(type)) {
    res.status(400).json({ error: 'Invalid type filter' });
    return;
  }

  const rows = type
    ? (db
        .prepare(
          `SELECT * FROM ngram_stats
           WHERE user_id = ? AND layout_id = ? AND ngram_type = ?`,
        )
        .all(userId, layoutId, type) as NgramStat[])
    : (db
        .prepare(
          `SELECT * FROM ngram_stats WHERE user_id = ? AND layout_id = ?`,
        )
        .all(userId, layoutId) as NgramStat[]);

  res.json(rows);
});

export default router;
