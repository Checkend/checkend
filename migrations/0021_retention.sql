-- Migration 0021: an index for the retention job (it deletes hourly counts by hour).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

CREATE INDEX issue_counts_hour ON issue_counts (hour);
