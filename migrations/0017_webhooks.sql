-- Migration 0017: outgoing webhooks (for example to start an agent run), with retries.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- secret and auth are encrypted values ("enc1:<key id>:..."; core/crypto.ts). A deleted webhook
-- keeps its row (deleted_at), so that its deliveries keep their history.

CREATE TABLE webhooks (
  id          INTEGER PRIMARY KEY,
  uid         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'checkend',
  secret      TEXT NOT NULL,
  auth        TEXT,
  events      TEXT NOT NULL,
  min_trust   TEXT NOT NULL DEFAULT 'high',
  project_id  INTEGER REFERENCES projects (id),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  deleted_at  TEXT
);

-- One delivery of one event to one webhook. status: pending, delivered or failed.
CREATE TABLE webhook_deliveries (
  id               INTEGER PRIMARY KEY,
  webhook_id       INTEGER NOT NULL REFERENCES webhooks (id),
  event            TEXT NOT NULL,
  issue_id         INTEGER,
  status           TEXT NOT NULL DEFAULT 'pending',
  attempts         INTEGER NOT NULL DEFAULT 0,
  next_attempt_at  TEXT NOT NULL,
  locked_until     TEXT,
  last_status      INTEGER,
  last_error       TEXT,
  created_at       TEXT NOT NULL,
  delivered_at     TEXT
);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
CREATE INDEX webhook_deliveries_webhook ON webhook_deliveries (webhook_id, id);
