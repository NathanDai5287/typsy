import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import { getCurrentUserId } from '../db/dataMode.js';
import type { SessionPayload, Session } from '@typsy/shared';

const router: ExpressRouter = Router();

router.post('/', (req, res) => {
  const db = getDb();
  // Server is the source of truth for which user the session belongs to —
  // any user_id from the body is ignored so the FE can't write across modes.
  const userId = getCurrentUserId();
  const payload = req.body as SessionPayload;

  const {
    layout_id,
    started_at,
    ended_at,
    mode,
    wpm,
    accuracy,
    chars_typed,
    errors,
  } = payload;

  // Compute cumulative_chars_at_session_end
  const prevSession = db
    .prepare(
      `SELECT cumulative_chars_at_session_end FROM sessions
       WHERE user_id = ? AND layout_id = ?
       ORDER BY ended_at DESC LIMIT 1`,
    )
    .get(userId, layout_id) as { cumulative_chars_at_session_end: number } | undefined;

  const cumulative_chars_at_session_end =
    (prevSession?.cumulative_chars_at_session_end ?? 0) + chars_typed;

  const result = db
    .prepare(
      `INSERT INTO sessions
         (user_id, layout_id, started_at, ended_at, mode, wpm, accuracy,
          chars_typed, errors, cumulative_chars_at_session_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      layout_id,
      started_at,
      ended_at,
      mode,
      wpm,
      accuracy,
      chars_typed,
      errors,
      cumulative_chars_at_session_end,
    );

  // Update last_session_at in user_layout_progress
  db.prepare(
    `UPDATE user_layout_progress SET last_session_at = ?
     WHERE user_id = ? AND layout_id = ?`,
  ).run(ended_at, userId, layout_id);

  const session: Session = {
    ...payload,
    user_id: userId,
    id: result.lastInsertRowid as number,
    cumulative_chars_at_session_end,
  };

  res.status(201).json(session);
});

/**
 * GET /api/sessions?layout_id=X[&limit=N]
 *
 * Returns sessions in reverse-chronological order. Limit defaults to 200.
 */
router.get('/', (req, res) => {
  const db = getDb();
  const userId = getCurrentUserId();
  const layoutId = Number(req.query.layout_id);
  const limit = Math.min(Number(req.query.limit ?? 200) || 200, 1000);

  if (!Number.isFinite(layoutId)) {
    res.status(400).json({ error: 'layout_id query param is required' });
    return;
  }

  const rows = db
    .prepare(
      `SELECT * FROM sessions
       WHERE user_id = ? AND layout_id = ?
       ORDER BY ended_at DESC
       LIMIT ?`,
    )
    .all(userId, layoutId, limit) as Session[];

  res.json(rows);
});

export default router;
