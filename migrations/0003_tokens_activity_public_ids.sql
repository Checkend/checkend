-- Migration 0003: scoped API tokens, the audit timeline, and public project IDs.
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

-- A random public ID for each project.
-- The public ID is in the DSN, the ingest URL and the API; the row ID never leaves Checkend.
-- It stays numeric, because Sentry SDKs accept only digits as the project ID of a DSN.
-- SQLite cannot add a NOT NULL UNIQUE column to a table with rows, so the column is added,
-- existing rows get a random 10-digit value, and a unique index enforces uniqueness.
-- The code sets public_id for every new project.

ALTER TABLE projects ADD COLUMN public_id INTEGER;

UPDATE projects SET public_id = 1000000000 + abs(random() % 9000000000) WHERE public_id IS NULL;

CREATE UNIQUE INDEX projects_public_id ON projects (public_id);
