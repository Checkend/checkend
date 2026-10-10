-- Migration 0014: the fix loop. Releases, deploys, and fixes linked to issues.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- Issue statuses for the loop: fix_pending (a fix is linked), verified (the fix is deployed and
-- the error stopped for the quiet period), regressed (the error came back in a release that
-- contains the fix).

CREATE TABLE releases (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects (id),
  version     TEXT NOT NULL,
  commit_sha  TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, version)
);

-- A deploy of a release to an environment. `uid` lets the statements of the same batch find
-- the new row.
CREATE TABLE deploys (
  id           INTEGER PRIMARY KEY,
  uid          TEXT NOT NULL UNIQUE,
  project_id   INTEGER NOT NULL REFERENCES projects (id),
  release_id   INTEGER NOT NULL REFERENCES releases (id),
  environment  TEXT NOT NULL,
  commit_sha   TEXT NOT NULL,
  source       TEXT NOT NULL,
  deployed_at  TEXT NOT NULL
);
CREATE INDEX deploys_project_environment ON deploys (project_id, environment, id);
CREATE INDEX deploys_release ON deploys (release_id);

-- What a deploy contains: the deployed commit, the commits since the last deploy, and pull
-- requests (kind 'commit' or 'pr').
CREATE TABLE deploy_refs (
  deploy_id  INTEGER NOT NULL REFERENCES deploys (id),
  kind       TEXT NOT NULL,
  ref        TEXT NOT NULL,
  PRIMARY KEY (deploy_id, kind, ref)
);
CREATE INDEX deploy_refs_ref ON deploy_refs (kind, ref);

-- A fix linked to an issue (a commit SHA or a pull request URL). The latest fix of an issue
-- is its current fix; a new link replaces an open one (outcome 'replaced').
-- quiet_since: the start of the quiet period; an event that Checkend cannot place in an
-- older release starts it again.
CREATE TABLE fixes (
  id             INTEGER PRIMARY KEY,
  issue_id       INTEGER NOT NULL REFERENCES issues (id),
  kind           TEXT NOT NULL,
  ref            TEXT NOT NULL,
  linked_by_type TEXT NOT NULL,
  linked_by_id   INTEGER,
  linked_by      TEXT NOT NULL,
  linked_at      TEXT NOT NULL,
  deploy_id      INTEGER REFERENCES deploys (id),
  deployed_at    TEXT,
  quiet_since    TEXT,
  outcome        TEXT,
  verified_at    TEXT,
  regressed_at   TEXT,
  regressed_in   TEXT
);
CREATE INDEX fixes_issue ON fixes (issue_id, id);
CREATE INDEX fixes_ref ON fixes (kind, ref);
CREATE INDEX fixes_waiting ON fixes (deployed_at) WHERE outcome IS NULL;

-- Fix outcomes for analysis: one row per fix with an outcome.
CREATE VIEW fix_outcomes AS
SELECT
  f.id AS fix_id,
  f.issue_id,
  f.kind,
  f.ref,
  f.linked_by_type,
  f.linked_by,
  f.linked_at,
  f.deployed_at,
  f.outcome,
  f.verified_at,
  f.regressed_at,
  f.regressed_in,
  CASE WHEN f.verified_at IS NOT NULL
    THEN round((julianday(f.verified_at) - julianday(f.linked_at)) * 24, 1) END AS hours_to_verified,
  CASE WHEN f.verified_at IS NOT NULL
    THEN round((julianday(f.verified_at) - julianday(i.first_seen)) * 24, 1) END AS hours_to_fix
FROM fixes f JOIN issues i ON i.id = f.issue_id
WHERE f.outcome IN ('verified', 'regressed');
