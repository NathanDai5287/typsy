-- Add Firebase Auth linkage to the users table.
--
-- `firebase_uid` is the stable identifier Firebase assigns to a Google account.
-- Nullable so existing rows survive (the synthetic user_id=2 will never sign in,
-- and the real user_id=1 gets its UID stamped in on first sign-in via the
-- TYPSY_OWNER_FIREBASE_UID env var; see apps/server/src/auth.ts).
--
-- SQLite's ALTER TABLE ADD COLUMN does not allow inline UNIQUE/PRIMARY KEY,
-- so the uniqueness constraint goes on a separate index. Functionally
-- equivalent: a unique index permits multiple rows with NULL but rejects
-- duplicate non-null values, which is exactly what we want — two different
-- Firebase accounts can never collide onto the same row.
ALTER TABLE users
  ADD COLUMN firebase_uid TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS users_firebase_uid_unique
  ON users(firebase_uid);
