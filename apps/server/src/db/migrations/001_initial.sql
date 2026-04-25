CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  settings_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS layouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  key_positions_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_layout_progress (
  user_id INTEGER NOT NULL,
  layout_id INTEGER NOT NULL,
  unlocked_keys_json TEXT NOT NULL DEFAULT '[]',
  phase INTEGER NOT NULL DEFAULT 0,
  fingering_map_json TEXT NOT NULL DEFAULT '{}',
  current_mode TEXT NOT NULL DEFAULT 'flow',
  last_session_at TEXT,
  PRIMARY KEY (user_id, layout_id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (layout_id) REFERENCES layouts(id)
);

CREATE TABLE IF NOT EXISTS ngram_stats (
  user_id INTEGER NOT NULL,
  layout_id INTEGER NOT NULL,
  ngram TEXT NOT NULL,
  ngram_type TEXT NOT NULL CHECK (ngram_type IN ('char1','char2','char3','word1','word2')),
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  total_time_ms INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, layout_id, ngram, ngram_type)
);

CREATE INDEX IF NOT EXISTS idx_ngram_stats_lookup
  ON ngram_stats(user_id, layout_id, ngram_type);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  layout_id INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  mode TEXT NOT NULL,
  wpm REAL NOT NULL,
  accuracy REAL NOT NULL,
  chars_typed INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  cumulative_chars_at_session_end INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (layout_id) REFERENCES layouts(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_layout
  ON sessions(user_id, layout_id, ended_at);
