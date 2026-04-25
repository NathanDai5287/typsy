import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import { getCurrentUserId } from '../db/dataMode.js';
import type { NgramBatchPayload, NgramStat } from '@typsy/shared';

const router: ExpressRouter = Router();

router.post('/batch', (req, res) => {
  const db = getDb();
  const userId = getCurrentUserId();
  const { layout_id, deltas } = req.body as NgramBatchPayload;

  if (!layout_id || !Array.isArray(deltas) || deltas.length === 0) {
    res.status(400).json({ error: 'layout_id and non-empty deltas are required' });
    return;
  }

  const upsert = db.prepare(
    `INSERT INTO ngram_stats
       (user_id, layout_id, ngram, ngram_type, hits, misses, total_time_ms, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, layout_id, ngram, ngram_type) DO UPDATE SET
       hits = hits + excluded.hits,
       misses = misses + excluded.misses,
       total_time_ms = total_time_ms + excluded.total_time_ms,
       last_seen_at = excluded.last_seen_at`,
  );

  const runAll = db.transaction(() => {
    for (const delta of deltas) {
      upsert.run(
        userId,
        layout_id,
        delta.ngram,
        delta.ngram_type,
        delta.hits_delta,
        delta.misses_delta,
        delta.time_delta_ms,
      );
    }
  });

  runAll();

  res.json({ ok: true, count: deltas.length });
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
  const userId = getCurrentUserId();
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
