# AI triage and similar issues

Checkend can ask a Cloudflare Workers AI model to triage each issue: the likely cause, the
severity, and whether the error is transient, noise, or a good task for an agent. It can also
find [similar issues](#similar-issues). Both are **advice only**: Checkend shows them in the
issue brief, and never acts on them.

AI is **off by default**.

## Turn it on

1. Give Checkend access to Workers AI:
   - On Cloudflare, add the AI binding to your Worker config:

     ```jsonc
     "ai": { "binding": "AI" }
     ```

   - On Node (Docker), set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (a token with the
     **Workers AI Read** permission).
2. Set `AI_TRIAGE=on`.

Every model call goes through Cloudflare AI Gateway:

| Setting | Default | What it does |
|---|---|---|
| `AI_TRIAGE` | off | `on`: triage issues. |
| `AI_GATEWAY_ID` | `default` | The AI Gateway to use. AI Gateway makes it on the first request. |
| `AI_GATEWAY_LOGS` | off | `on`: the gateway stores the prompts and the responses. |
| `AI_SIMILAR` | off | `on`: find similar issues (see [Similar issues](#similar-issues)). |

## What the model sees

The model gets only the error:

- the title, the level, the platform, the environment and the message
- the exception types and values (at most 3 exceptions)
- the top 8 frames of each exception (in-app frames first); only the top frame has one source
  line

It never gets the user, the request, tags, extra data, contexts, breadcrumbs, the server name or
the release.

Just before the call, Checkend removes secrets again, with the default rules and the
[project rules](what-checkend-stores.md#your-own-scrub-rules). Then it replaces email
addresses, IP addresses, UUIDs, long hex values, numbers with 5 or more digits, and the query
strings of URLs with placeholders.

Checkend keeps the model input short: when an error is very large, Checkend sends fewer
exceptions and frames, and shorter texts.

## When an issue is triaged

- A Cron Trigger triages open issues that were seen 3 or more times, 20 issues in each run.
- When an agent asks for the brief of an issue without a triage, `get_issue_brief` triages it
  first, with a limit of 5 seconds.
- After a failed call, Checkend waits 1 day before it tries that issue again.

A fast model answers first. When its confidence in the category is below 0.5, a larger model
answers again.

## In the brief

The brief has a field `triage` (or `null`), and the Markdown brief has a
"Triage (model advice)" table:

| Field | Meaning |
|---|---|
| `category` | `code_bug`, `dependency`, `infrastructure`, `configuration`, `user_input`, `external_service` or `other`, with its confidence and the probabilities of all categories. |
| `severity` | A score from 0 to 3, with a level and a confidence. |
| `p_transient` | The probability that the error goes away by itself. |
| `p_agent_fixable` | The probability that a coding agent can fix it. |
| `p_noise` | The probability that the issue is noise. |

It also has `notice`, `model`, `version` and `triaged_at`. The triage is advice: actions on
issues keep their own rules, for example [approvals](api.md#approvals).

## Correct the triage

When the triage is wrong, an agent or a person can correct it: the MCP tool `correct_triage`, or
[`POST /v1/issues/:id/triage-correction`](api.md#post-v1issuesidtriage-correction) (with
`issues:write`). Give at least one of `category`, `severity` (0 to 3), `transient`,
`agent_fixable` and `noise`, and an optional `note`.

A correction is a [triage label](api.md#triage-labels): `label` is `triage_corrected`, and
`corrects` is `triage`. Its data keeps the model answer of that time.

## Similar issues

With `AI_SIMILAR=on`, Checkend finds issues that are like each other, also across projects.

It needs a vector index:

- On Cloudflare: the AI binding, and a Vectorize index that you create and bind as `VECTORIZE`:

  ```sh
  npx wrangler vectorize create checkend-issues --dimensions=1024 --metric=cosine
  ```

  ```jsonc
  "vectorize": [{ "binding": "VECTORIZE", "index_name": "checkend-issues" }]
  ```

- On Node: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The vectors stay in SQLite.

The cron makes a vector for each new issue, from the same scrubbed text as the triage. Later, it
finds the similar issues of each issue: a cosine similarity of 0.75 or more, ordered by a
reranker model, at most 5.

The brief has a field `similar_issues`: a list of `{id, project_id, status, score, title}`. The
title is untrusted text.

An agent can also search: the MCP tool `search_similar`, or
[`POST /v1/similar`](api.md#post-v1similar), with an `issue_id` or a `text`. Checkend removes
secrets from a text before it makes the vector.
