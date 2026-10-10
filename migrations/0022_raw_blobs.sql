-- Migration 0022: a raw payload too large for D1 goes to the blob store; the event keeps its key.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

ALTER TABLE events ADD COLUMN raw_key TEXT;
