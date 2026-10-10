-- Migration 0001: instance settings.
-- Rules (D16, D17): valid on D1 and SQLite; forward-only and additive; no triggers.
-- Single-tenant (D18): no org_id or tenant_id columns.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
