-- Rename ngram_stats.total_time_ms → hit_time_ms.
--
-- Semantic change: the column now accumulates inter-keypress time only on
-- successful (hit) first-attempt keystrokes. Miss times are discarded.
-- Previously the tracker added time on both hits and misses but downstream
-- callers divided by hits only, producing artificially low WPM whenever the
-- user made any errors. The new semantic matches "mean time per clean hit"
-- without the numerator/denominator mismatch.
--
-- This migration is safe to run on the wiped DB (no rows). On a populated DB
-- the existing values would carry over but represent the OLD semantic — the
-- table should be wiped before practicing further if mixed semantics matter.

ALTER TABLE ngram_stats RENAME COLUMN total_time_ms TO hit_time_ms;
