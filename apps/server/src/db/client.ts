import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'typsy.db');
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

  runMigrations(_db);
  seedData(_db);

  return _db;
}

/**
 * Apply every `*.sql` file in `migrations/` in lexical order. Each migration
 * is recorded in `_migrations` so it only runs once. Migrations are wrapped
 * in a transaction so a partial application can't leave the DB inconsistent.
 */
function runMigrations(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  );

  const allFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const appliedRows = db.prepare('SELECT name FROM _migrations').all() as { name: string }[];
  const applied = new Set(appliedRows.map((r) => r.name));

  for (const file of allFiles) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
    });
    apply();
    console.log(`[migrations] applied ${file}`);
  }
}
