-- Migration 0035: events per project and UTC minute ("2026-10-10T12:34"), for the Live and
-- 60-minute views of the dashboard chart. Written in the same batch as the event (one more row
-- written per event); retention keeps only the last hours (src/core/series.ts), so the table stays
-- small: at most 60 rows per project and hour kept.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- WITHOUT ROWID and no other index: one B-tree, so a new minute writes one row (rows written
-- are billed). Retention scans the small table by minute.
CREATE TABLE minute_counts (
  project_id INTEGER NOT NULL REFERENCES projects (id),
  minute     TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, minute)
) WITHOUT ROWID;
