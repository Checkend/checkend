-- Model triage of issues (advice only). One row per issue: the latest answers.
-- model: the model that answered (clef-flash, or clef after an escalation).
-- version: the version of the question set (TRIAGE_VERSION).
-- answers: JSON, question id to answer (probabilities, confidence); null after a failed call.
-- error: the reason of the last failed call (a new try after a day).
CREATE TABLE issue_triage (
  issue_id   INTEGER PRIMARY KEY REFERENCES issues (id),
  model      TEXT NOT NULL,
  version    INTEGER NOT NULL,
  answers    TEXT,
  error      TEXT,
  triaged_at TEXT NOT NULL
);
