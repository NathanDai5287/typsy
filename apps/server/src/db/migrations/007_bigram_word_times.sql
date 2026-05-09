-- Per-(bigram, word) hit-time tracking.
--
-- For every clean char2 hit that fires inside a known target word, we
-- accumulate the inter-keypress interval here. Mean = hit_time_ms / hits =
-- "how long does this bigram take when it appears inside this specific word,
-- on clean attempts." Drives the dashboard's "slow in" subsection: rank by
-- absolute mean ms DESC to see the words where a given bigram is slow.
--
-- This is the timing counterpart to bigram_word_misses (which tracks
-- per-(bigram, target_word, typed_word) miss counts). Misses live there;
-- hits and their times live here.

CREATE TABLE IF NOT EXISTS bigram_word_times (
  user_id      INTEGER NOT NULL,
  layout_id    INTEGER NOT NULL,
  bigram       TEXT NOT NULL,
  target_word  TEXT NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  hit_time_ms  INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, layout_id, bigram, target_word),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (layout_id) REFERENCES layouts(id)
);

CREATE INDEX IF NOT EXISTS idx_bigram_word_times_lookup
  ON bigram_word_times(user_id, layout_id, bigram);
