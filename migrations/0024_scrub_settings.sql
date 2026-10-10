-- Migration 0024: scrub settings per project (JSON arrays; NULL: none).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- scrub_keys: literal key names whose values are filtered. scrub_patterns: regular expressions,
-- checked for speed when they are saved (core/scrub-settings.ts).

ALTER TABLE projects ADD COLUMN scrub_keys TEXT;
ALTER TABLE projects ADD COLUMN scrub_patterns TEXT;
