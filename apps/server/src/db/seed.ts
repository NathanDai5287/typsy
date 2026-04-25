import type Database from 'better-sqlite3';
import { LAYOUT_DEFINITIONS } from '@typsy/shared';
import { REAL_USER_ID, SYNTHETIC_USER_ID } from './dataMode.js';

export function seedData(db: Database.Database): void {
  const insertLayout = db.prepare(
    `INSERT OR IGNORE INTO layouts (name, key_positions_json) VALUES (?, ?)`,
  );

  for (const layout of LAYOUT_DEFINITIONS) {
    insertLayout.run(layout.name, layout.key_positions_json);
  }

  // Two users always exist: id=1 holds real data (everything actually typed),
  // id=2 holds synthetic data (whatever `seed:dev` produces). The server
  // routes between them based on TYPSY_DATA_MODE — see `db/dataMode.ts`.
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (id) VALUES (?)`);
  insertUser.run(REAL_USER_ID);
  insertUser.run(SYNTHETIC_USER_ID);
}
