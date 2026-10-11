-- Migration 0029: similar issues (AI_SIMILAR).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

-- The embedding of an issue: the model, and the scrubbed and normalized text that was embedded
-- (the reranker compares these texts). The vector is in the vector index (Vectorize, or the
-- vectors table on Node). neighbors_at: when its similar issues were computed.
CREATE TABLE issue_embeddings (
  issue_id     INTEGER PRIMARY KEY REFERENCES issues (id),
  model        TEXT NOT NULL,
  text         TEXT NOT NULL,
  embedded_at  TEXT NOT NULL,
  neighbors_at TEXT
);
CREATE INDEX issue_embeddings_neighbors ON issue_embeddings (neighbors_at);

-- Similar issues, computed by the cron (the brief reads them; no model call in the brief).
CREATE TABLE issue_similar (
  issue_id    INTEGER NOT NULL REFERENCES issues (id),
  similar_id  INTEGER NOT NULL REFERENCES issues (id),
  score       REAL NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (issue_id, similar_id)
);
CREATE INDEX issue_similar_similar ON issue_similar (similar_id);

-- The vector index of the Node runtime (sqliteVectorIndex). Float32 values. Not used with Vectorize.
CREATE TABLE vectors (
  id     TEXT PRIMARY KEY,
  vector BLOB NOT NULL
);
