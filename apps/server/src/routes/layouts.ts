import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import { getCurrentUserId } from '../db/dataMode.js';
import type { Layout, LayoutSummary, User, UserSettings } from '@typsy/shared';

const router: ExpressRouter = Router();

/** Names of layouts seeded at install time — these can never be deleted. */
const SEEDED_NAMES = new Set(['QWERTY', 'Colemak', 'Graphite']);

router.get('/', (_req, res) => {
  const db = getDb();
  const layouts = db.prepare('SELECT * FROM layouts').all() as Layout[];
  res.json(layouts);
});

/**
 * POST /api/layouts — create a new custom layout (e.g. an optimized variant).
 *
 * Body: { name: string, key_positions_json: string }
 * Returns the newly-created Layout row.
 */
router.post('/', (req, res) => {
  const db = getDb();
  const { name, key_positions_json } = req.body as {
    name?: string;
    key_positions_json?: string;
  };

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof key_positions_json !== 'string' || !key_positions_json.trim()) {
    res.status(400).json({ error: 'key_positions_json is required' });
    return;
  }

  // Validate JSON parses to an array
  try {
    const parsed = JSON.parse(key_positions_json);
    if (!Array.isArray(parsed)) {
      res.status(400).json({ error: 'key_positions_json must be an array' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'key_positions_json is not valid JSON' });
    return;
  }

  if (SEEDED_NAMES.has(name)) {
    res.status(400).json({ error: 'Cannot use a seeded layout name' });
    return;
  }

  try {
    const result = db
      .prepare('INSERT INTO layouts (name, key_positions_json) VALUES (?, ?)')
      .run(name.trim(), key_positions_json);
    const id = result.lastInsertRowid as number;
    const row = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) as Layout;
    res.status(201).json(row);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      res.status(409).json({ error: 'A layout with that name already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create layout' });
  }
});

/**
 * DELETE /api/layouts/:id — delete a custom (non-seeded) layout. Cascades
 * to user_layout_progress, sessions, and ngram_stats. If the deleted layout
 * was active, picks any remaining layout_progress row as the new active.
 */
router.delete('/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid id' });
    return;
  }

  const layout = db.prepare('SELECT * FROM layouts WHERE id = ?').get(id) as Layout | undefined;
  if (!layout) {
    res.status(404).json({ error: 'Layout not found' });
    return;
  }
  if (SEEDED_NAMES.has(layout.name)) {
    res.status(400).json({ error: 'Seeded layouts cannot be deleted' });
    return;
  }

  // Read user settings to detect "was this the active layout?"
  const userId = getCurrentUserId();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  let settings: UserSettings = {};
  if (user) {
    try {
      settings = JSON.parse(user.settings_json) as UserSettings;
    } catch {
      // ignore
    }
  }
  const wasActive = settings.active_layout_id === id;

  const tx = db.transaction(() => {
    // Manual cascade — schema doesn't have ON DELETE CASCADE. Layouts are
    // shared across users, so deleting one wipes its data for both the real
    // and synthetic users.
    db.prepare('DELETE FROM ngram_stats WHERE layout_id = ?').run(id);
    db.prepare('DELETE FROM sessions WHERE layout_id = ?').run(id);
    db.prepare('DELETE FROM user_layout_progress WHERE layout_id = ?').run(id);
    db.prepare('DELETE FROM layouts WHERE id = ?').run(id);
  });
  tx();

  if (wasActive) {
    // Fall back to whatever progress row exists for the current-mode user.
    const fallback = db
      .prepare('SELECT layout_id FROM user_layout_progress WHERE user_id = ? LIMIT 1')
      .get(userId) as { layout_id: number } | undefined;
    const newActive = fallback?.layout_id;
    const newSettings = { ...settings, active_layout_id: newActive };
    db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(
      JSON.stringify(newSettings),
      userId,
    );
  }

  res.json({ ok: true });
});

/**
 * GET /api/layouts/summary
 *
 * Per-layout snapshot used by the /layouts page: name, progression status,
 * total chars, last WPM, etc. Includes layouts the user hasn't onboarded yet.
 */
router.get('/summary', (_req, res) => {
  const db = getDb();
  const userId = getCurrentUserId();

  const rows = db
    .prepare(
      `SELECT
         l.id              AS layout_id,
         l.name            AS layout_name,
         l.key_positions_json,
         p.is_main_layout  AS is_main_layout,
         p.unlocked_keys_json,
         COALESCE(stats.total_chars, 0)  AS total_chars,
         COALESCE(stats.session_count, 0) AS session_count,
         latest.last_wpm,
         latest.last_session_at,
         (p.layout_id IS NOT NULL) AS has_progress
       FROM layouts l
       LEFT JOIN user_layout_progress p
         ON p.layout_id = l.id AND p.user_id = ?
       LEFT JOIN (
         SELECT layout_id,
                SUM(chars_typed) AS total_chars,
                COUNT(*)         AS session_count
         FROM sessions WHERE user_id = ?
         GROUP BY layout_id
       ) stats ON stats.layout_id = l.id
       LEFT JOIN (
         SELECT s1.layout_id,
                s1.wpm     AS last_wpm,
                s1.ended_at AS last_session_at
         FROM sessions s1
         WHERE s1.user_id = ?
         AND   s1.ended_at = (
           SELECT MAX(s2.ended_at) FROM sessions s2
           WHERE s2.user_id = ? AND s2.layout_id = s1.layout_id
         )
       ) latest ON latest.layout_id = l.id
       ORDER BY l.id`,
    )
    .all(userId, userId, userId, userId) as Array<{
      layout_id: number;
      layout_name: string;
      key_positions_json: string;
      is_main_layout: number | null;
      unlocked_keys_json: string | null;
      total_chars: number;
      session_count: number;
      last_wpm: number | null;
      last_session_at: string | null;
      has_progress: number;
    }>;

  // Resolve active layout from settings.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  let activeId: number | undefined;
  if (user) {
    try {
      const settings = JSON.parse(user.settings_json) as UserSettings;
      activeId = settings.active_layout_id;
    } catch {
      // ignore
    }
  }

  const summary: LayoutSummary[] = rows.map((r) => {
    let unlockedCount = 0;
    if (r.unlocked_keys_json) {
      try {
        unlockedCount = (JSON.parse(r.unlocked_keys_json) as string[]).length;
      } catch {
        // ignore
      }
    }
    return {
      layout: {
        id: r.layout_id,
        name: r.layout_name,
        key_positions_json: r.key_positions_json,
      },
      has_progress: !!r.has_progress,
      is_main_layout: r.is_main_layout === 1,
      is_active: activeId === r.layout_id,
      unlocked_keys_count: unlockedCount,
      total_chars: r.total_chars,
      session_count: r.session_count,
      last_wpm: r.last_wpm,
      last_session_at: r.last_session_at,
    };
  });

  res.json(summary);
});

export default router;
