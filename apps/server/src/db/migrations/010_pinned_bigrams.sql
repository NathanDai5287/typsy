-- Add pinned_bigrams_json to user_layout_progress
ALTER TABLE user_layout_progress ADD COLUMN pinned_bigrams_json TEXT DEFAULT '[]';
