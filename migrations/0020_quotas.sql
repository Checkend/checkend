-- Migration 0020: a daily event quota per project (NULL: no quota).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- The count comes from issue_counts (hourly counts), so the quota needs no extra writes.

ALTER TABLE projects ADD COLUMN daily_quota INTEGER;
