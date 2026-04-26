import { Router } from 'express';
import type { Router as ExpressRouter } from 'express';
import { getDb } from '../db/client.js';
import { requireUserId } from '../auth.js';
import {
  pickInitialSubset,
  type User,
  type UserLayoutProgress,
  type OnboardingPayload,
  type InitialSetupPayload,
  type ProgressUpdatePayload,
  type UserFingeringPayload,
  type UserResponse,
  type Layout,
  type KeyPosition,
  type FingerLabel,
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

function writeSettings(
  db: ReturnType<typeof getDb>,
  userId: number,
  settings: UserSettings,
): void {
  db.prepare('UPDATE users SET settings_json = ? WHERE id = ?').run(
    JSON.stringify(settings),
    userId,
  );
}

router.get('/', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User | undefined;
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  let layout_progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = ?')
    .all(userId) as UserLayoutProgress[];

  // Idempotent backfill: rows created before the auto-subset change have
  // unlocked_keys_json='[]'. Compute the proper initial subset for those rows
  // so the practice page has something to generate text from.
  const layoutById = new Map<number, Layout>(
    (db.prepare('SELECT * FROM layouts').all() as Layout[]).map((l) => [l.id, l]),
  );
  const update = db.prepare(
    `UPDATE user_layout_progress
     SET unlocked_keys_json = ?
     WHERE user_id = ? AND layout_id = ? AND unlocked_keys_json = '[]'`,
  );
  let didUpdate = false;
  for (const row of layout_progress) {
    if (row.unlocked_keys_json === '[]') {
      const layout = layoutById.get(row.layout_id);
      if (!layout) continue;
      const positions = JSON.parse(layout.key_positions_json) as KeyPosition[];
      const subset = pickInitialSubset(positions);
      update.run(JSON.stringify(subset), userId, row.layout_id);
      didUpdate = true;
    }
  }
  if (didUpdate) {
    layout_progress = db
      .prepare('SELECT * FROM user_layout_progress WHERE user_id = ?')
      .all(userId) as UserLayoutProgress[];
  }

  // Resolve active layout — defaults to the first row if not set yet.
  const settings = readSettings(user);
  const validIds = new Set(layout_progress.map((p) => p.layout_id));
  let activeId = settings.active_layout_id;
  if (activeId === undefined || !validIds.has(activeId)) {
    activeId = layout_progress[0]?.layout_id;
    if (activeId !== undefined && activeId !== settings.active_layout_id) {
      writeSettings(db, userId, { ...settings, active_layout_id: activeId });
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
  const userId = requireUserId(req);
  const { layout_id } = req.body as SetActiveLayoutPayload;

  if (typeof layout_id !== 'number') {
    res.status(400).json({ error: 'layout_id is required' });
    return;
  }

  const progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = ? AND layout_id = ?')
    .get(userId, layout_id) as UserLayoutProgress | undefined;
  if (!progress) {
    res.status(400).json({ error: 'No progress for this layout — onboard it first' });
    return;
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  const settings = readSettings(user);
  writeSettings(db, userId, { ...settings, active_layout_id: layout_id });

  res.json({ ok: true, active_layout_id: layout_id });
});

router.post('/onboarding', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const { layout_id } = req.body as OnboardingPayload;

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
       (user_id, layout_id, unlocked_keys_json, current_mode)
     VALUES (?, ?, ?, 'flow')
     ON CONFLICT(user_id, layout_id) DO UPDATE SET
       unlocked_keys_json = COALESCE(user_layout_progress.unlocked_keys_json, excluded.unlocked_keys_json)`,
  ).run(userId, layout_id, JSON.stringify(initialUnlocked));

  // First-time onboarding: make this layout the active one if none was set.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  const settings = readSettings(user);
  if (settings.active_layout_id === undefined) {
    writeSettings(db, userId, { ...settings, active_layout_id: layout_id });
  }

  const layout_progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = ?')
    .all(userId) as UserLayoutProgress[];
  const userAfter = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;

  res.json({ user: userAfter, layout_progress });
});

/**
 * POST /api/user/initial-setup — first-run setup. Records the user's
 * daily-driver layout (marked `is_main_layout=1`, all alpha keys unlocked)
 * and, optionally, a second layout they'd like to learn (marked
 * `is_main_layout=0`, standard initial-subset unlock). The active layout is
 * set to the learn layout when present, else the daily driver, so the
 * Practice page opens straight on whatever the user is here to do.
 *
 * All writes happen in a single transaction so an HTTP retry can't leave
 * the user with a daily driver but no learn layout (or vice versa).
 */
router.post('/initial-setup', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const { daily_driver_layout_id, learn_layout_id } = req.body as InitialSetupPayload;

  if (typeof daily_driver_layout_id !== 'number') {
    res.status(400).json({ error: 'daily_driver_layout_id is required' });
    return;
  }
  if (
    learn_layout_id !== undefined &&
    learn_layout_id !== null &&
    typeof learn_layout_id !== 'number'
  ) {
    res.status(400).json({ error: 'learn_layout_id must be a number when provided' });
    return;
  }
  if (
    learn_layout_id !== undefined &&
    learn_layout_id !== null &&
    learn_layout_id === daily_driver_layout_id
  ) {
    res
      .status(400)
      .json({ error: 'learn_layout_id must differ from daily_driver_layout_id' });
    return;
  }

  const dailyDriverLayout = db
    .prepare('SELECT * FROM layouts WHERE id = ?')
    .get(daily_driver_layout_id) as Layout | undefined;
  if (!dailyDriverLayout) {
    res.status(400).json({ error: 'daily_driver_layout_id not found' });
    return;
  }
  const learnLayout =
    learn_layout_id !== undefined && learn_layout_id !== null
      ? (db.prepare('SELECT * FROM layouts WHERE id = ?').get(learn_layout_id) as
          | Layout
          | undefined)
      : undefined;
  if (learn_layout_id !== undefined && learn_layout_id !== null && !learnLayout) {
    res.status(400).json({ error: 'learn_layout_id not found' });
    return;
  }

  // Daily driver: all alpha keys unlocked from day one — the user already
  // knows the layout, so progressive unlock would just be in their way.
  // Practice page already short-circuits the unlock check when
  // is_main_layout=1; persisting the full set here keeps the row sensible
  // if the user later toggles to "learning".
  const dailyPositions = JSON.parse(dailyDriverLayout.key_positions_json) as KeyPosition[];
  const dailyDriverUnlocked = dailyPositions
    .filter((p) => /^[a-z]$/.test(p.char))
    .map((p) => p.char);

  // Learn layout (optional): standard initial subset (home row + a few).
  const learnUnlocked = learnLayout
    ? pickInitialSubset(JSON.parse(learnLayout.key_positions_json) as KeyPosition[])
    : null;

  const insertProgress = db.prepare(
    `INSERT INTO user_layout_progress
       (user_id, layout_id, unlocked_keys_json, current_mode, is_main_layout)
     VALUES (?, ?, ?, 'flow', ?)
     ON CONFLICT(user_id, layout_id) DO UPDATE SET
       unlocked_keys_json = excluded.unlocked_keys_json,
       is_main_layout = excluded.is_main_layout`,
  );

  db.transaction(() => {
    // The user has exactly one daily driver. Clear the flag on every
    // existing row first so re-running initial-setup with a different
    // choice doesn't leave a phantom second daily-driver flag behind.
    // We don't touch unlocked_keys_json / phase / last_session_at on
    // other rows — those still represent practice the user has done.
    db.prepare('UPDATE user_layout_progress SET is_main_layout = 0 WHERE user_id = ?').run(
      userId,
    );

    insertProgress.run(
      userId,
      daily_driver_layout_id,
      JSON.stringify(dailyDriverUnlocked),
      1,
    );
    if (learnLayout && learnUnlocked) {
      insertProgress.run(
        userId,
        learnLayout.id,
        JSON.stringify(learnUnlocked),
        0,
      );
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
    const settings = readSettings(user);
    const activeId = learnLayout?.id ?? daily_driver_layout_id;
    writeSettings(db, userId, { ...settings, active_layout_id: activeId });
  })();

  const layout_progress = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = ?')
    .all(userId) as UserLayoutProgress[];
  const userAfter = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;

  // Mirror the active-first ordering that GET /api/user produces, since
  // OnboardingPage seeds the user query with this response and downstream
  // pages (e.g. PracticePage) read `layout_progress[0]` as the active row.
  const activeId = readSettings(userAfter).active_layout_id;
  if (activeId !== undefined) {
    layout_progress.sort((a, b) => {
      if (a.layout_id === activeId) return -1;
      if (b.layout_id === activeId) return 1;
      return a.layout_id - b.layout_id;
    });
  }

  const response: UserResponse = { user: userAfter, layout_progress };
  res.json(response);
});

/**
 * POST /api/user/fingering — replace the user's layout-independent fingering
 * map. The body is a JSON string keyed by physical position (`"row,col"`),
 * not by character; that's what makes it apply across every layout.
 */
router.post('/fingering', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
  const { fingering_map_json } = req.body as UserFingeringPayload;

  if (typeof fingering_map_json !== 'string') {
    res.status(400).json({ error: 'fingering_map_json is required' });
    return;
  }

  // Validate it parses and looks like Record<string, FingerLabel>. Reject
  // garbage early so corrupt data can't reach the consumers.
  let parsed: Record<string, FingerLabel>;
  try {
    parsed = JSON.parse(fingering_map_json) as Record<string, FingerLabel>;
  } catch {
    res.status(400).json({ error: 'fingering_map_json is not valid JSON' });
    return;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    res.status(400).json({ error: 'fingering_map_json must be an object' });
    return;
  }

  db.prepare('UPDATE users SET fingering_map_json = ? WHERE id = ?').run(
    JSON.stringify(parsed),
    userId,
  );

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  res.json(user);
});

/**
 * POST /api/user/progress
 *
 * Patch unlocked_keys_json, current_mode, and/or phase for the given
 * (user, layout). Only fields present in the body are updated.
 */
router.post('/progress', (req, res) => {
  const db = getDb();
  const userId = requireUserId(req);
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

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  params.push(userId, payload.layout_id);

  const result = db
    .prepare(
      `UPDATE user_layout_progress SET ${updates.join(', ')}
       WHERE user_id = ? AND layout_id = ?`,
    )
    .run(...params);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Progress row not found' });
    return;
  }

  const row = db
    .prepare('SELECT * FROM user_layout_progress WHERE user_id = ? AND layout_id = ?')
    .get(userId, payload.layout_id) as UserLayoutProgress;

  res.json(row);
});

export default router;
