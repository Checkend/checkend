-- Migration 0015: GitHub. A project can name its repository (owner/name); the GitHub webhook
-- reports pushes, merged pull requests and deployments for it.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.

ALTER TABLE projects ADD COLUMN repository TEXT;
CREATE INDEX projects_repository ON projects (repository);

-- Commits pushed to a branch, in push order (id). A deploy of a commit contains the commits
-- pushed to the same branch before it (since the last deploy to the same environment).
CREATE TABLE pushed_commits (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects (id),
  branch      TEXT NOT NULL,
  sha         TEXT NOT NULL,
  pushed_at   TEXT NOT NULL
);
CREATE INDEX pushed_commits_sha ON pushed_commits (project_id, sha);
CREATE INDEX pushed_commits_branch ON pushed_commits (project_id, branch, id);

-- Merged pull requests and their merge commits: a deploy that contains the merge commit
-- contains the pull request.
CREATE TABLE pr_merges (
  project_id  INTEGER NOT NULL REFERENCES projects (id),
  pr_url      TEXT NOT NULL,
  merge_sha   TEXT NOT NULL,
  merged_at   TEXT NOT NULL,
  PRIMARY KEY (project_id, pr_url)
);
CREATE INDEX pr_merges_sha ON pr_merges (project_id, merge_sha);

-- Delivery IDs (X-GitHub-Delivery) of the last days: a redelivery does not count twice.
CREATE TABLE github_deliveries (
  id           TEXT PRIMARY KEY,
  event        TEXT NOT NULL,
  received_at  TEXT NOT NULL
);
CREATE INDEX github_deliveries_received ON github_deliveries (received_at);
