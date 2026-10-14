-- Migration 0034: member visits, for "since your last visit" on the dashboard.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- last_visit_at: the last dashboard view (written at most once a minute).
-- previous_visit_at: the end of the visit before the current one (a new visit starts after
-- 30 minutes away).

ALTER TABLE members ADD COLUMN last_visit_at TEXT;
ALTER TABLE members ADD COLUMN previous_visit_at TEXT;

-- The dashboard counts the activity of a time window.
CREATE INDEX activity_at ON activity (at);
