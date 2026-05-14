-- Per-word typing-time tracking.
--
-- Captures the time from the first keypress of a word to its last keypress,
-- including time spent on intra-word errors and corrections. Aggregated per
-- (user, layout, word). Mean = hit_time_ms / hits = average milliseconds to
-- type one attempt of this word. Drives the dashboard's "top 10 slowest
-- words" section.
--
-- The first word of a session and the trailing word at session end are
-- excluded by the client tracker (the first word's time is unrepresentative
-- reading/orienting time; the last is cut off or wound down).

CREATE TABLE IF NOT EXISTS word_times (
  user_id      INTEGER NOT NULL,
  layout_id    INTEGER NOT NULL,
  word         TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  hit_time_ms  INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, layout_id, word),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (layout_id) REFERENCES layouts(id)
);

CREATE INDEX IF NOT EXISTS idx_word_times_lookup
  ON word_times(user_id, layout_id);
