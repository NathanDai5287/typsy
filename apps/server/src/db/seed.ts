import type Database from 'better-sqlite3';
import { LAYOUT_DEFINITIONS } from '@typsy/shared';

export function seedData(db: Database.Database): void {
  const insertLayout = db.prepare(
    `INSERT OR IGNORE INTO layouts (name, key_positions_json) VALUES (?, ?)`,
  );

  for (const layout of LAYOUT_DEFINITIONS) {
    insertLayout.run(layout.name, layout.key_positions_json);
  }

  // Create the single default user (id = 1) if not present.
  db.prepare(`INSERT OR IGNORE INTO users (id) VALUES (1)`).run();
}
