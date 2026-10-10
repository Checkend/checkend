-- Migration 0011: claims (leases), so that two agents do not work on the same issue.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- A claim is active while claim_expires_at is in the future. Notes are activity rows.

ALTER TABLE issues ADD COLUMN claimed_by_type TEXT;
ALTER TABLE issues ADD COLUMN claimed_by_id INTEGER;
ALTER TABLE issues ADD COLUMN claimed_by TEXT;
ALTER TABLE issues ADD COLUMN claim_expires_at TEXT;
