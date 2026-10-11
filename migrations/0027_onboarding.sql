-- Migration 0027: agent-first onboarding (setup keys, setup progress), demo and deleted projects.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- Setup keys (cks_...): short-lived keys that an agent uses to connect apps. Only the hash is stored.
CREATE TABLE setup_keys (
  id         INTEGER PRIMARY KEY,
  key_hash   TEXT NOT NULL UNIQUE,
  prefix     TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

-- The setup progress of an app (a project). Only steps that other tables do not record.
CREATE TABLE project_setup (
  project_id       INTEGER PRIMARY KEY REFERENCES projects (id),
  setup_key_id     INTEGER REFERENCES setup_keys (id),
  connected_at     TEXT NOT NULL,
  sdk_installed_at TEXT,
  test_event_at    TEXT
);
CREATE INDEX project_setup_key ON project_setup (setup_key_id);

-- Agent tokens made with a setup key: the key, the app, and the first MCP call.
ALTER TABLE tokens ADD COLUMN setup_key_id INTEGER;
ALTER TABLE tokens ADD COLUMN project_id INTEGER;
ALTER TABLE tokens ADD COLUMN first_mcp_at TEXT;
ALTER TABLE tokens ADD COLUMN mcp_client TEXT;
CREATE INDEX tokens_setup_key ON tokens (setup_key_id);

-- demo: the demo project (the UI offers "Delete demo"). deleted_at: deleted, purge in progress.
ALTER TABLE projects ADD COLUMN demo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
