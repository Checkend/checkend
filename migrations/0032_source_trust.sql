-- Migration 0032: source trust per app, from the SDK class of its events.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- server_seen_at / client_seen_at: the last event from a server SDK, or from a browser, mobile
-- or unknown SDK (ingest writes them at most once an hour). A class counts for 30 days; a client
-- class makes the app low trust, unless an admin sets `trust` (core/trust.ts).
-- browser_seen_at (0016) is no longer written. It holds the FIRST client event, which can be
-- older than 30 days: an app with it gets the migration time instead, so it stays low trust for
-- 30 more days, then follows the window. The format is the one of toISOString().

ALTER TABLE projects ADD COLUMN server_seen_at TEXT;
ALTER TABLE projects ADD COLUMN client_seen_at TEXT;
UPDATE projects SET client_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE browser_seen_at IS NOT NULL;
