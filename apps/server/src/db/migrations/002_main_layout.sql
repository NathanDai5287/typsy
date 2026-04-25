-- Adds an "is_main_layout" flag to user_layout_progress. When set, the
-- practice page treats every alpha key as already unlocked (i.e. the user
-- already knows this layout — it's their daily driver). Progressive
-- unlocking + review-resurface logic only applies to non-main layouts.
ALTER TABLE user_layout_progress
  ADD COLUMN is_main_layout INTEGER NOT NULL DEFAULT 0;
