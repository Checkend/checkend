-- Migration 0012: hourly event counts and users affected per issue.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- One row per issue and UTC hour ("2026-10-10T12"). Written in the same batch as the event.
CREATE TABLE issue_counts (
  issue_id INTEGER NOT NULL REFERENCES issues (id),
  hour     TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (issue_id, hour)
);

-- Distinct users per issue, by a hash of the user ID (or email, username or IP address).
-- At most 1,000 users per issue are stored; users_affected stops there.
CREATE TABLE issue_users (
  issue_id   INTEGER NOT NULL REFERENCES issues (id),
  user_hash  TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (issue_id, user_hash)
);

ALTER TABLE issues ADD COLUMN users_affected INTEGER NOT NULL DEFAULT 0;
