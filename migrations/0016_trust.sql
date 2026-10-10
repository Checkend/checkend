-- Migration 0016: trust levels by source, and allowed origins for browser projects.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- A DSN that a browser uses is public: anyone can send events with it. The first event with an
-- Origin header sets browser_seen_at; the project is then low trust, unless an admin sets
-- `trust` ('low' or 'high'). allowed_origins: a JSON array of origins, or NULL (any origin).

ALTER TABLE projects ADD COLUMN trust TEXT;
ALTER TABLE projects ADD COLUMN browser_seen_at TEXT;
ALTER TABLE projects ADD COLUMN allowed_origins TEXT;
