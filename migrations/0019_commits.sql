-- Migration 0019: commits, for the suspect commit of an issue. From GitHub push deliveries, or
-- from the GitHub API with GITHUB_TOKEN (the cron fetches the commits of each new deploy).
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- files: a JSON array of the changed paths, or NULL when Checkend does not know them.
-- deploys.commits_status: NULL (not fetched yet), 'done' or 'failed'.

CREATE TABLE commits (
  project_id    INTEGER NOT NULL REFERENCES projects (id),
  sha           TEXT NOT NULL,
  message       TEXT NOT NULL,
  author        TEXT,
  committed_at  TEXT,
  files         TEXT,
  PRIMARY KEY (project_id, sha)
);

ALTER TABLE deploys ADD COLUMN commits_status TEXT;
CREATE INDEX deploys_commits_status ON deploys (commits_status, id);
