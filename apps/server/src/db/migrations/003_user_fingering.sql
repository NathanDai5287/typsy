-- Decouple fingerings from layouts.
--
-- Before this migration, fingerings lived on `user_layout_progress` keyed by
-- character — which forced a separate map per layout. That model is
-- conceptually wrong: the user's hands are anchored to the physical
-- keyboard, not to the characters a layout puts there. After this
-- migration, each user has a single fingering map keyed by physical
-- position (`"row,col"`), and it applies to every layout they practice.

-- 1. New per-user position-keyed fingering map.
ALTER TABLE users
  ADD COLUMN fingering_map_json TEXT NOT NULL DEFAULT '{}';

-- 2. Drop the obsolete per-layout char-keyed column.
--    SQLite has supported DROP COLUMN since 3.35 (March 2021), and
--    better-sqlite3 9.x bundles a recent enough version.
ALTER TABLE user_layout_progress
  DROP COLUMN fingering_map_json;
