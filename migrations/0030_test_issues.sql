-- Migration 0030: test issues. The setup test event makes a test issue: resolved, without
-- counts, alerts, webhooks, triage or embeddings, and left out of the default issue list.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
ALTER TABLE issues ADD COLUMN test INTEGER NOT NULL DEFAULT 0;

-- Test events of earlier setups: mark their issues, and remove their counts.
UPDATE issues SET test = 1, status = 'resolved'
WHERE title = 'Checkend test event: the setup works. This is a test; you can resolve this issue.';
DELETE FROM issue_counts WHERE issue_id IN (SELECT id FROM issues WHERE test = 1);
DELETE FROM issue_users WHERE issue_id IN (SELECT id FROM issues WHERE test = 1);
UPDATE issues SET users_affected = 0 WHERE test = 1;
