import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

// db/client.ts resolves the DB path against process.cwd(), and getDb()
// memoizes the connection on first use. So we have to chdir to a tmp dir
// AND import the modules-under-test BEFORE anything else hits getDb().
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'typsy-progress-test-'));
const originalCwd = process.cwd();
process.chdir(tmpDir);
process.env.BYPASS_AUTH = '1';
delete process.env.TYPSY_DATA_MODE; // real-user mode (id=1)

const { getDb } = await import('../db/client.js');
const { authMiddleware } = await import('../auth.js');
const userRouter = (await import('./user.js')).default;

let server: http.Server;
let baseUrl: string;
let db: Database.Database;
let qwertyId: number;
let colemakId: number;
let dvorakId: number;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api', authMiddleware);
  app.use('/api/user', userRouter);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address() as { port: number };
  baseUrl = `http://localhost:${addr.port}/api`;

  db = getDb();
  qwertyId = (db.prepare('SELECT id FROM layouts WHERE name = ?').get('QWERTY') as { id: number }).id;
  colemakId = (db.prepare('SELECT id FROM layouts WHERE name = ?').get('Colemak') as { id: number }).id;
  dvorakId = (db.prepare('SELECT id FROM layouts WHERE name = ?').get('Dvorak') as { id: number }).id;
});

afterAll(() => {
  server?.close();
  db?.close();
  process.chdir(originalCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Reset to a clean slate for user_id=1: QWERTY = current daily driver,
  // Colemak = learning, Dvorak = onboarded but not yet primary. Active layout
  // starts on QWERTY so we can test "did the toggle move it".
  db.prepare('DELETE FROM user_layout_progress WHERE user_id = 1').run();
  const ins = db.prepare(
    `INSERT INTO user_layout_progress (user_id, layout_id, unlocked_keys_json, current_mode, is_main_layout)
     VALUES (1, ?, '[]', 'flow', ?)`,
  );
  ins.run(qwertyId, 1);
  ins.run(colemakId, 0);
  ins.run(dvorakId, 0);
  db.prepare('UPDATE users SET settings_json = ? WHERE id = 1').run(
    JSON.stringify({ active_layout_id: qwertyId }),
  );
});

function dailyDriverIds(): number[] {
  return (
    db
      .prepare('SELECT layout_id FROM user_layout_progress WHERE user_id = 1 AND is_main_layout = 1')
      .all() as { layout_id: number }[]
  ).map((r) => r.layout_id);
}

function activeLayoutId(): number | undefined {
  const user = db.prepare('SELECT settings_json FROM users WHERE id = 1').get() as {
    settings_json: string;
  };
  return JSON.parse(user.settings_json).active_layout_id;
}

describe('POST /api/user/progress — is_main_layout single-daily-driver invariant', () => {
  it('clears is_main_layout=1 on every other row when promoting a layout', async () => {
    expect(dailyDriverIds()).toEqual([qwertyId]);

    const res = await fetch(`${baseUrl}/user/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_id: dvorakId, is_main_layout: true }),
    });
    expect(res.status).toBe(200);

    expect(dailyDriverIds()).toEqual([dvorakId]);
  });

  it('also moves active_layout_id to the promoted layout', async () => {
    expect(activeLayoutId()).toBe(qwertyId);

    await fetch(`${baseUrl}/user/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_id: dvorakId, is_main_layout: true }),
    });

    expect(activeLayoutId()).toBe(dvorakId);
  });

  it('does not move active_layout_id when un-marking', async () => {
    // Start with QWERTY as both daily driver AND active. Un-marking QWERTY
    // should leave the user typing on QWERTY — they didn't ask to switch.
    await fetch(`${baseUrl}/user/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_id: qwertyId, is_main_layout: false }),
    });

    expect(activeLayoutId()).toBe(qwertyId);
    expect(dailyDriverIds()).toEqual([]);
  });

  it('still works for partial updates that omit is_main_layout', async () => {
    const before = dailyDriverIds();
    const res = await fetch(`${baseUrl}/user/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_id: colemakId, current_mode: 'drill' }),
    });
    expect(res.status).toBe(200);

    // Daily-driver flag should be untouched on every row.
    expect(dailyDriverIds()).toEqual(before);
    const row = db
      .prepare('SELECT current_mode FROM user_layout_progress WHERE user_id = 1 AND layout_id = ?')
      .get(colemakId) as { current_mode: string };
    expect(row.current_mode).toBe('drill');
  });

  it('returns 404 when the target progress row does not exist', async () => {
    const orphanId = 9999999;
    const res = await fetch(`${baseUrl}/user/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout_id: orphanId, is_main_layout: true }),
    });
    expect(res.status).toBe(404);

    // The "clear other rows" step must NOT have committed — we only clear
    // if the promotion actually lands on a real row. Otherwise the user
    // could accidentally wipe their daily driver by typo'ing a layout id.
    expect(dailyDriverIds()).toEqual([qwertyId]);
  });
});
