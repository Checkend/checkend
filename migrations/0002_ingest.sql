-- Migration 0002: projects, DSN keys, issues, sampled events, tag keys, daily usage.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- Single-tenant: no org_id or tenant_id columns. Times are ISO 8601 text in UTC.

CREATE TABLE projects (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  platform   TEXT,
  created_at TEXT NOT NULL
);

-- DSN keys. The public key is in the DSN and is not a secret.
CREATE TABLE project_keys (
  id         INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id),
  public_key TEXT NOT NULL UNIQUE,
  label      TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE issues (
  id                  INTEGER PRIMARY KEY,
  project_id          INTEGER NOT NULL REFERENCES projects (id),
  fingerprint         TEXT NOT NULL,
  fingerprint_version INTEGER NOT NULL,
  title               TEXT NOT NULL,
  culprit             TEXT,
  type                TEXT,
  level               TEXT NOT NULL,
  platform            TEXT,
  status              TEXT NOT NULL DEFAULT 'unresolved',
  times_seen          INTEGER NOT NULL DEFAULT 1,
  stored_events       INTEGER NOT NULL DEFAULT 0,
  first_seen          TEXT NOT NULL,
  last_seen           TEXT NOT NULL,
  first_release       TEXT,
  last_release        TEXT,
  UNIQUE (project_id, fingerprint)
);
CREATE INDEX issues_project_last_seen ON issues (project_id, last_seen DESC, id DESC);
CREATE INDEX issues_last_seen ON issues (last_seen DESC, id DESC);
CREATE INDEX issues_project_first_seen ON issues (project_id, first_seen);

-- Sampled events: at most N per issue. `data` is the normalized, scrubbed event for display.
-- `raw` is the scrubbed original payload, gzip-compressed, for re-processing only; it is
-- NULL when it is above the size limit (`raw_size` keeps the original size).
CREATE TABLE events (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects (id),
  issue_id    INTEGER NOT NULL REFERENCES issues (id),
  event_id    TEXT NOT NULL,
  timestamp   TEXT NOT NULL,
  received_at TEXT NOT NULL,
  level       TEXT NOT NULL,
  release     TEXT,
  environment TEXT,
  data        TEXT NOT NULL,
  raw         BLOB,
  raw_size    INTEGER NOT NULL,
  UNIQUE (project_id, event_id)
);
CREATE INDEX events_issue ON events (issue_id, id DESC);

-- Known tag keys per project (capped, so that one SDK cannot create unlimited keys).
CREATE TABLE tag_keys (
  project_id INTEGER NOT NULL REFERENCES projects (id),
  key        TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, key)
);

-- Ingest counters per UTC day: budget mode (D1 daily write limit) and write failures.
CREATE TABLE daily_usage (
  day             TEXT PRIMARY KEY,
  events_received INTEGER NOT NULL DEFAULT 0,
  events_stored   INTEGER NOT NULL DEFAULT 0,
  rows_written    INTEGER NOT NULL DEFAULT 0,
  write_failures  INTEGER NOT NULL DEFAULT 0
);
