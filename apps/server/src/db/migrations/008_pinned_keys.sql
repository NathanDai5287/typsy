-- Add pinned_keys_json to user_layout_progress
ALTER TABLE user_layout_progress ADD COLUMN pinned_keys_json TEXT DEFAULT '[]';
