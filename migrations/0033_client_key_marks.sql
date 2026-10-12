-- Migration 0033: a client mark per DSN key that does not expire.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- client_marked_at: the first event from a browser, mobile or unknown SDK (or with an Origin
-- header) that came with this key. Such a key is public, so it never gives high trust again:
-- the app stays low trust while an active key has the mark, until the key is rotated (a new
-- key, then the old one revoked) or an admin sets `trust` (core/trust.ts).
-- An app with client_seen_at (0032) had a client source: all its keys get the mark (fail closed).

ALTER TABLE project_keys ADD COLUMN client_marked_at TEXT;
UPDATE project_keys SET client_marked_at = (
  SELECT p.client_seen_at FROM projects p WHERE p.id = project_keys.project_id
) WHERE project_id IN (SELECT id FROM projects WHERE client_seen_at IS NOT NULL);
CREATE INDEX project_keys_project ON project_keys (project_id);
