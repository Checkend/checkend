-- Migration 0028: triage corrections in the triage labels.
-- Rules (AGENTS.md): valid on D1 and SQLite; forward-only and additive; no triggers.
-- The view of 0013 again, plus 'issue.triage_correct': a person or an agent corrects the model
-- triage (label 'triage_corrected', corrects 'triage'). The data has the correction and the model
-- answer of that time, for CheckendBench.

DROP VIEW triage_labels;

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
    WHEN 'issue.triage_correct' THEN 'triage_corrected'
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
    WHEN a.action = 'issue.triage_correct' THEN 'triage'
  END AS corrects
FROM activity a
WHERE a.target_type = 'issue'
  AND a.action IN ('issue.resolve', 'issue.ignore', 'issue.unresolve', 'issue.regress', 'issue.merge',
    'issue.split', 'issue.triage_correct');
