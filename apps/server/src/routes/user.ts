import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import {
  pickInitialSubset,
  type User,
  type UserLayoutProgress,
  type OnboardingPayload,
  type ProgressUpdatePayload,
  type UserResponse,
  type Layout,
  type KeyPosition,
  type SetActiveLayoutPayload,
  type UserSettings,
} from '@typsy/shared';

const router: ExpressRouter = Router();

function readSettings(user: User): UserSettings {
  try {
    return JSON.parse(user.settings_json) as UserSettings;
  } catch {
    return {};
  }
}

function writeSettings(db: ReturnType<typeof getDb>, settings: UserSettings): void {
  db.prepare('UPDATE users SET settings_json = ? WHERE id = 1').run(JSON.stringify(settings));
}

router.get('/', (_req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as User | undefined;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let layout_progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = 1')
    .all() as UserLayoutProgress[];

  // Idempotent backfill: rows created before the auto-subset change have
  // unlocked_keys_json='[]'. Compute the proper initial subset for those rows
  // so the practice page has something to generate text from.
  const layoutById = new Map<number, Layout>(
    (db.prepare('SELECT * FROM layouts').all() as Layout[]).map((l) => [l.id, l]),
  );
  const update = db.prepare(
    `UPDATE user_layout_progress
     SET unlocked_keys_json = ?
     WHERE user_id = 1 AND layout_id = ? AND unlocked_keys_json = '[]'`,
  );
  let didUpdate = false;
  for (const row of layout_progress) {
    if (row.unlocked_keys_json === '[]') {
      const layout = layoutById.get(row.layout_id);
      if (!layout) continue;
      const positions = JSON.parse(layout.key_positions_json) as KeyPosition[];
      const subset = pickInitialSubset(positions);
      update.run(JSON.stringify(subset), row.layout_id);
      didUpdate = true;
    }
  }
  if (didUpdate) {
    layout_progress = db
      .prepare('SELECT * FROM user_layout_progress WHERE user_id = 1')
      .all() as UserLayoutProgress[];
  }

  // Resolve active layout — defaults to the first row if not set yet.
  const settings = readSettings(user);
  const validIds = new Set(layout_progress.map((p) => p.layout_id));
  let activeId = settings.active_layout_id;
  if (activeId === undefined || !validIds.has(activeId)) {
    activeId = layout_progress[0]?.layout_id;
    if (activeId !== undefined && activeId !== settings.active_layout_id) {
      writeSettings(db, { ...settings, active_layout_id: activeId });
    }
  }

  // Sort: active row first, then alphabetically by layout name. Keeps the
  // existing `layout_progress[0]` clients happy.
  if (activeId !== undefined) {
    layout_progress.sort((a, b) => {
      if (a.layout_id === activeId) return -1;
      if (b.layout_id === activeId) return 1;
      return (
        (layoutById.get(a.layout_id)?.name ?? '').localeCompare(
          layoutById.get(b.layout_id)?.name ?? '',
        )
      );
    });
  }

  const response: UserResponse = { user, layout_progress };
  res.json(response);
});

/**
 * POST /api/user/active-layout — change which layout is currently being practiced.
 */
router.post('/active-layout', (req, res) => {
  const db = getDb();
  const { layout_id } = req.body as SetActiveLayoutPayload;

  if (typeof layout_id !== 'number') {
    res.status(400).json({ error: 'layout_id is required' });
    return;
  }

  const progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = 1 AND layout_id = ?')
    .get(layout_id) as UserLayoutProgress | undefined;
  if (!progress) {
    res.status(400).json({ error: 'No progress for this layout — onboard it first' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as User;
  const settings = readSettings(user);
  writeSettings(db, { ...settings, active_layout_id: layout_id });

  res.json({ ok: true, active_layout_id: layout_id });
});

router.post('/onboarding', (req, res) => {
  const db = getDb();
  const { layout_id, fingering_map_json } = req.body as OnboardingPayload;

  if (!layout_id || typeof layout_id !== 'number') {
    res.status(400).json({ error: 'layout_id is required' });
    return;
  }

  const layout = db
    .prepare('SELECT * FROM layouts WHERE id = ?')
    .get(layout_id) as Layout | undefined;
  if (!layout) {
    res.status(400).json({ error: 'Layout not found' });
    return;
  }

  // Compute the initial unlocked-key subset for this layout (spec §6.3).
  const positions = JSON.parse(layout.key_positions_json) as KeyPosition[];
  const initialUnlocked = pickInitialSubset(positions);

  db.prepare(
    `INSERT INTO user_layout_progress
       (user_id, layout_id, fingering_map_json, unlocked_keys_json, current_mode)
     VALUES (1, ?, ?, ?, 'flow')
     ON CONFLICT(user_id, layout_id) DO UPDATE SET
       fingering_map_json = excluded.fingering_map_json,
       unlocked_keys_json = COALESCE(user_layout_progress.unlocked_keys_json, excluded.unlocked_keys_json)`,
  ).run(layout_id, fingering_map_json ?? '{}', JSON.stringify(initialUnlocked));

  // First-time onboarding: make this layout the active one if none was set.
  const user = db.prepare('SELECT * FROM users WHERE id = 1').get() as User;
  const settings = readSettings(user);
  if (settings.active_layout_id === undefined) {
    writeSettings(db, { ...settings, active_layout_id: layout_id });
  }

  const layout_progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = 1')
    .all() as UserLayoutProgress[];
  const userAfter = db.prepare('SELECT * FROM users WHERE id = 1').get() as User;

  res.json({ user: userAfter, layout_progress });
});

/**
 * POST /api/user/progress
 *
 * Patch unlocked_keys_json, current_mode, and/or phase for the given
 * (user, layout). Only fields present in the body are updated.
 */
router.post('/progress', (req, res) => {
  const db = getDb();
  const payload = req.body as ProgressUpdatePayload;

  if (!payload.layout_id || typeof payload.layout_id !== 'number') {
    res.status(400).json({ error: 'layout_id is required' });
    return;
  }

  const updates: string[] = [];
  const params: (string | number)[] = [];

  if (payload.unlocked_keys_json !== undefined) {
    updates.push('unlocked_keys_json = ?');
    params.push(payload.unlocked_keys_json);
  }
  if (payload.current_mode !== undefined) {
    updates.push('current_mode = ?');
    params.push(payload.current_mode);
  }
  if (payload.phase !== undefined) {
    updates.push('phase = ?');
    params.push(payload.phase);
  }
  if (payload.is_main_layout !== undefined) {
    updates.push('is_main_layout = ?');
    params.push(payload.is_main_layout ? 1 : 0);
  }
  if (payload.fingering_map_json !== undefined) {
    updates.push('fingering_map_json = ?');
    params.push(payload.fingering_map_json);
  }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  params.push(payload.layout_id);

  const result = db
    .prepare(
      `UPDATE user_layout_progress SET ${updates.join(', ')}
       WHERE user_id = 1 AND layout_id = ?`,
    )
    .run(...params);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Progress row not found' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = 1 AND layout_id = ?')
    .get(payload.layout_id) as UserLayoutProgress;

  res.json(row);
});

export default router;
