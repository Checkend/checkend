-- Migration 0010: issue actions (resolve, ignore, merge) and approvals.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- A merged issue keeps its row: status 'merged', and merged_into points to the target. Later
-- events with its fingerprint go to the target.
ALTER TABLE issues ADD COLUMN merged_into INTEGER REFERENCES issues (id);
ALTER TABLE issues ADD COLUMN status_changed_at TEXT;

-- Actions that need a human approval (REQUIRE_APPROVAL). They expire after 7 days.
CREATE TABLE approvals (
  id                INTEGER PRIMARY KEY,
  action            TEXT NOT NULL,
  issue_id          INTEGER NOT NULL REFERENCES issues (id),
  payload           TEXT,
  requested_by_type TEXT NOT NULL,
  requested_by_id   INTEGER,
  requested_by      TEXT NOT NULL,
  requested_at      TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  decided_by        TEXT,
  decided_at        TEXT
);
CREATE INDEX approvals_status ON approvals (status, id DESC);
