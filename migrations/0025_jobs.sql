-- Migration 0025: a jobs table, the queue of the Node runtime (Cloudflare uses Queues instead;
-- there the table stays empty). At-least-once: a claimed job has a lock time (the visibility
-- timeout); a job that keeps failing is marked dead (the dead-letter state).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

CREATE TABLE jobs (
  id            INTEGER PRIMARY KEY,
  queue         TEXT NOT NULL,
  body          TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  run_after     TEXT NOT NULL,
  locked_until  TEXT,
  status        TEXT NOT NULL DEFAULT 'ready',
  last_error    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX jobs_ready ON jobs (queue, status, run_after);
