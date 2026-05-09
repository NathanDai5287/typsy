-- Per-bigram missed-word context.
-- For each (user, layout, bigram), stores how many times each (target_word, typed_word) pair
-- showed up as a miss. typed_word freezes the FIRST wrong character at the miss position
-- (target prefix up to the miss + the wrong char that was typed first).
CREATE TABLE IF NOT EXISTS bigram_word_misses (
  user_id      INTEGER NOT NULL,
  layout_id    INTEGER NOT NULL,
  bigram       TEXT NOT NULL,
  target_word  TEXT NOT NULL,
  typed_word   TEXT NOT NULL,
  miss_count   INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, layout_id, bigram, target_word, typed_word),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (layout_id) REFERENCES layouts(id)
);

CREATE INDEX IF NOT EXISTS idx_bigram_word_misses_lookup
  ON bigram_word_misses(user_id, layout_id, bigram);
