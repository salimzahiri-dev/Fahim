-- 0003: a start is idempotent. The page sends a random start key with "Commencer";
-- a repeated start with the same key (double tap, request retried after a lost
-- response) returns the session it created instead of creating a second one.

ALTER TABLE sessions
  ADD COLUMN start_key   uuid,
  ADD COLUMN start_reply jsonb;

CREATE UNIQUE INDEX sessions_one_per_start_key ON sessions (org_id, student_id, start_key) WHERE start_key IS NOT NULL;
