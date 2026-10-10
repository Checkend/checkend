-- Migration 0004: a random public ID for each project.
-- The public ID is in the DSN, the ingest URL and the API; the row ID never leaves Checkend.
-- It stays numeric, because Sentry SDKs accept only digits as the project ID of a DSN.
-- SQLite cannot add a NOT NULL UNIQUE column to a table with rows, so the column is added,
-- existing rows get a random 10-digit value, and a unique index enforces uniqueness.
-- The code sets public_id for every new project.

ALTER TABLE projects ADD COLUMN public_id INTEGER;

UPDATE projects SET public_id = 1000000000 + abs(random() % 9000000000) WHERE public_id IS NULL;

CREATE UNIQUE INDEX projects_public_id ON projects (public_id);
