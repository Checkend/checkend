-- Migration 0013: triage labels, derived from the activity timeline.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- A view, so the labels always match the activity and need no extra writes. A correction is an
-- action that reverses an earlier decision: "unresolved" or "regressed" after "resolved" or
-- "ignored", and "split" (a correction of the grouping).

CREATE VIEW triage_labels AS
SELECT
  a.id,
  a.at,
  a.target_id AS issue_id,
  CASE a.action
    WHEN 'issue.resolve' THEN 'resolved'
    WHEN 'issue.ignore' THEN 'ignored'
    WHEN 'issue.unresolve' THEN 'unresolved'
    WHEN 'issue.regress' THEN 'regressed'
    WHEN 'issue.merge' THEN 'merged'
    WHEN 'issue.split' THEN 'split'
  END AS label,
  a.actor_type,
  a.actor_name,
  a.data,
  CASE
    WHEN a.action IN ('issue.unresolve', 'issue.regress') THEN (
      SELECT CASE p.action WHEN 'issue.resolve' THEN 'resolved' WHEN 'issue.ignore' THEN 'ignored' END
      FROM activity p
      WHERE p.target_type = 'issue' AND p.target_id = a.target_id AND p.id < a.id
        AND p.action IN ('issue.resolve', 'issue.ignore', 'issue.unresolve', 'issue.regress')
      ORDER BY p.id DESC
      LIMIT 1
    )
    WHEN a.action = 'issue.split' THEN 'grouping'
  END AS corrects
FROM activity a
WHERE a.target_type = 'issue'
  AND a.action IN ('issue.resolve', 'issue.ignore', 'issue.unresolve', 'issue.regress', 'issue.merge', 'issue.split');
