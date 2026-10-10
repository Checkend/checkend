-- Migration 0018: source maps. The index (core/sourcemap-index.ts) is in the blob store; this
-- table finds it. One map per project, release and file path; a new upload replaces it.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- path: the URL path of the minified file ("~/static/app.js" and
-- "https://cdn.example/static/app.js" are both "/static/app.js").

CREATE TABLE sourcemaps (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects (id),
  release      TEXT NOT NULL,
  name         TEXT NOT NULL,
  path         TEXT NOT NULL,
  blob_key     TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sources      INTEGER NOT NULL,
  uploaded_at  TEXT NOT NULL,
  uploaded_by  TEXT NOT NULL,
  UNIQUE (project_id, release, path)
);
