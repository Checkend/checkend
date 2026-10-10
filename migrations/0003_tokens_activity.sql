-- Migration 0003: scoped API tokens and the audit timeline.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- API tokens. Only the SHA-256 hash of a token is stored; the token is shown once.
CREATE TABLE tokens (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  scopes       TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  prefix       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  created_by   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

-- Every write by every actor (agent token, admin token, later humans).
CREATE TABLE activity (
  id          INTEGER PRIMARY KEY,
  at          TEXT NOT NULL,
  actor_type  TEXT NOT NULL,
  actor_id    INTEGER,
  actor_name  TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   INTEGER,
  data        TEXT
);
CREATE INDEX activity_target ON activity (target_type, target_id, id DESC);
