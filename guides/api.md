# API

The Checkend API returns JSON. All endpoints start with `/v1`.

## Authentication

Each request needs a token in a header:

```
Authorization: Bearer <token>
```

The token is a scoped token (see [Tokens](#tokens)), or the `ADMIN_TOKEN` secret of the Worker
(see [Settings and health](settings.md)).

One endpoint is different: `POST /v1/ingest` takes the DSN key in the `X-Checkend-Key` header,
not a bearer token. See [Native JSON ingest](sending-errors.md#native-json-ingest). In the
OpenAPI document, it has the security scheme `dsnKey`.

`ADMIN_TOKEN` is the bootstrap admin token. It has all scopes. Use it to create scoped tokens,
then give each person or agent a token with only the scopes that it needs. Keep all tokens
secret.

### Scopes

| Scope | Gives access to |
|---|---|
| `issues:read` | `GET /v1/projects`, `/v1/issues`, `/v1/issues/:id`, `/v1/issues/:id/events`, `/v1/issues/:id/activity`, `/v1/events/:id` |
| `issues:write` | `POST /v1/issues/:id/resolve`, `/ignore`, `/unresolve`, `/merge`, `/split`, `/claim`, `/release` and `/notes`, and the MCP tools that change issues |
| `admin` | All scopes, and also `POST /v1/projects`, `GET` and `POST /v1/tokens`, `DELETE /v1/tokens/:id`, `GET /v1/activity`, `GET /v1/labels`, `GET /v1/approvals`, `POST /v1/approvals/:id/approve` and `/reject` |
| `releases:write` | No endpoint uses it yet. |

A coding agent that only reads errors needs `issues:read`. An agent that also resolves,
ignores or merges issues needs `["issues:read", "issues:write"]`. Coding agents can also use the
[MCP server](mcp.md).

The OpenAPI 3.1 document of this API is at `GET /v1/openapi.json`. It needs no token. Each
operation has `x-required-scope`.

## Errors

| Status | Body |
|---|---|
| `400` | `{"error": "invalid_request", "details": [{"path": ..., "message": ...}]}` |
| `401` | `{"error": "unauthorized"}`, with the header `WWW-Authenticate: Bearer`. The token is missing, not valid, or revoked. |
| `403` | `{"error": "forbidden", "required_scope": "<scope>"}`. The token does not have the scope that the endpoint needs. |
| `404` | `{"error": "not_found"}`, or `{"error": "project_not_found"}` when the `?project=` value matches no project. |

## Projects

Each project has a public ID: a random number with 10 digits, for example `4821937065`. The IDs
are not in order. The DSN, the ingest URL and the API use only this ID. It is a number, because
Sentry SDKs accept only digits as the project ID of a DSN.

### `GET /v1/projects`

Lists all projects, with their DSNs.

```json
{ "data": [ { "id": 4821937065, "name": "My App", "slug": "my-app", "platform": "node",
              "created_at": "...", "dsns": ["https://<key>@<host>/4821937065"] } ] }
```

### `POST /v1/projects`

Creates a project and its DSN.

Body: `{"name": "My App", "platform": "node"}`. `name` has 1 to 100 characters. `platform` is
optional (32 characters or fewer).

Returns `201`:

```json
{ "data": { "id": 4821937065, "name": "My App", "slug": "my-app", "platform": "node",
            "created_at": "...", "dsn": "https://<key>@<host>/4821937065" } }
```

The [project CLI](quick-start.md#3-create-a-project-and-get-a-dsn) calls these two endpoints.

## Issues

### `GET /v1/issues`

Lists issues. By default, the issue with the most recent event comes first.

| Query parameter | Values |
|---|---|
| `project` | A project ID (for example `4821937065`) or a project slug (for example `my-app`). |
| `status` | `unresolved`, `resolved`, `ignored` or `merged`. Without `status`, the list does not show merged issues. |
| `limit` | 1 to 100. The default is 25. |
| `cursor` | The `next_cursor` from the previous page. |
| `release` | Issues with this release: the first or last release of the issue, or a stored event. |
| `environment` | Issues with a stored event in this environment. |
| `since` | Issues last seen at or after this time: a duration (for example `30m`, `24h` or `7d`) or an ISO date or time. |
| `search` | Text in the title or the culprit, 200 characters at most. `%` and `_` are plain characters. |
| `claimed` | `true`: only issues with an active claim. `false`: only issues without one. |
| `sort` | `last_seen` (the default: the most recently seen first) or `priority` (the highest [priority](#priority-score) first). The cursor works with both. |

```json
{ "data": [ ... ], "next_cursor": "..." , "ingest": { ... } }
```

When `project` matches no project ID and no slug, the response is `404`
`{"error": "project_not_found"}`.

`next_cursor` is `null` on the last page. `ingest` is the ingest state (see
[Settings and health](settings.md#ingest-state)).

Each issue has these fields: `id`, `project_id` (the public project ID), `title`, `culprit`,
`type`, `level`, `platform`, `status`, `times_seen`, `stored_events`, `events_24h`,
`events_7d`, `users_affected`, `priority`, `first_seen`, `last_seen`, `first_release`,
`last_release`, `fingerprint`, `fingerprint_version`, `merged_into` and `claim`.

- `events_24h` and `events_7d`: the events in the last 24 hours and the last 7 days. Checkend
  counts them per UTC hour, so each window is the full hours inside it.
- `users_affected`: the number of different users. The user of an event is its `user.id`, else
  `user.email`, else `user.username`, else `user.ip_address`. For this count, Checkend stores
  only a hash of the value. The count stops at 1,000 per issue. An event without a user adds no
  user.
- `priority`: the [priority score](#priority-score).
- `merged_into`: the ID of the issue that this issue was merged into, or `null`.

An SDK that sends the same event again (the same `event_id`, while the event is stored) does not
make the counts go up twice. A merge moves the hourly counts and the users to the target issue.

`claim` is `{"holder": "agent-a", "expires_at": "..."}` when the issue has an active
[claim](#post-v1issuesidclaim), or `null`.

`times_seen` counts all events. `stored_events` counts the events that Checkend stored (see the
[caps](what-checkend-stores.md#4-caps-per-project)).

### `GET /v1/issues/:id`

Returns one issue, with one more field: `latest_event_id`, the ID of its most recent stored
event.

### Priority score

The priority score (version 1) puts the issues that hurt the most users now at the top:

```
priority = (1 + users_affected) × (1 + events_24h) × recency × newness
recency  = 1 / (1 + days since last seen)
newness  = 2 when the issue was first seen in the last 24 hours, else 1
```

Checkend computes the score when you ask for it, so it changes over time. It is a number with 3
decimals.

### `GET /v1/issues/:id/events`

Lists the stored events of an issue, the most recent first. `limit` is 1 to 100 (the default is
25).

Each event has these fields: `id`, `issue_id`, `project_id`, `event_id`, `timestamp`,
`received_at`, `level`, `release` and `environment`.

## Issue actions

These endpoints need the `issues:write` scope. When a person must approve the action first, the
response is `202` (see [Approvals](#approvals)).

### `POST /v1/issues/:id/resolve`

Sets the status to `resolved`. No body. Returns `200` with `{"data": <issue>}`, or `404` when the
issue is unknown or merged.

When a new event arrives for a resolved issue, the issue becomes `unresolved` again (a
regression). The activity timeline then gets `issue.regress`. An ignored issue stays ignored.

### `POST /v1/issues/:id/ignore`

Sets the status to `ignored`. No body. Returns `200` with `{"data": <issue>}`, or `404`.

### `POST /v1/issues/:id/unresolve`

Sets the status to `unresolved`. No body. Returns `200` with `{"data": <issue>}`, or `404`.

### `POST /v1/issues/:id/merge`

Merges other issues into this issue (the target). Body: `{"source_ids": [12, 15]}`, with 1 to 10
issue IDs. Returns `200` with `{"data": <target issue>}`.

What a merge does:

- The events and the counts (`times_seen`, `first_seen`, `last_seen`, stored events) move to the
  target issue.
- Each source issue gets the status `merged`, and `merged_into` is the target ID.
- Later events that would go to a source issue go to the target issue.

The response is `400` with `{"error": "invalid_request", "details": [{"path": "source_ids", ...}]}`
when a source is the target, when the target or a source is already merged, when a source is in
another project, or when a source is unknown. An unknown target issue (`:id`) gives `404`.

### `POST /v1/issues/:id/split`

The opposite of a merge: moves some stored events of this issue to a new issue. Body:
`{"event_ids": [101, 104]}`, with 1 to 100 Checkend event IDs (the `id` from
[`GET /v1/issues/:id/events`](#get-v1issuesidevents)). Returns `201` with
`{"data": <the new issue>}`.

What a split does:

- The chosen events move to a new issue in the same project.
- The new issue gets the title of the first moved event, the moved events, their hourly counts,
  and their part of `times_seen`. The original issue loses these, but it keeps a `times_seen`
  of at least 1.
- The users affected stay on the original issue.
- New events still go to the original issue: a split does not change grouping. To group later
  events in a different way, set an SDK fingerprint (see
  [grouping](what-checkend-stores.md#3-grouping-into-issues)).

The response is `400` with `{"error": "invalid_request", "details": [{"path": "event_ids", ...}]}`
for an empty list, an unknown event, or an event of another issue. An unknown or merged issue
gives `404`.

## Claims and notes

A claim tells other agents that one agent works on an issue. It is a lease: it ends when it
expires or when the holder releases it. These endpoints need the `issues:write` scope.

### `POST /v1/issues/:id/claim`

Claims the issue. The body is optional: `{"minutes": 60}`, 1 to 1440 (the default is 120).
Returns `200` with `{"data": <issue>}`, and the issue has
`"claim": {"holder": "agent-a", "expires_at": "..."}`. The holder is the name of the token (or
`ADMIN_TOKEN`).

The claim succeeds when the issue has no claim, when the claim expired, or when the same token
renews its own claim. Otherwise the response is `409`:
`{"error": "claimed", "claim": {"holder": ..., "expires_at": ...}}`. An unknown or merged issue
gives `404`.

### `POST /v1/issues/:id/release`

Releases the claim. Returns `200` with the issue (`claim` is `null`). Only the holder, or a token
with the `admin` scope, can release an active claim. Other tokens get `403`
`{"error": "forbidden", "reason": "Only the holder of the claim or an admin can release it."}`.
When the issue has no active claim, the response is `200`.

### `POST /v1/issues/:id/notes`

Adds a note to the timeline of the issue, for example the cause and the fix. Body:
`{"text": "..."}`, 1 to 4000 characters. Returns `201` with `{"data": {"id": <note id>}}`, or
`404` for an unknown issue.

Checkend cleans the text like event text: secrets become `[Filtered]`, and control and bidi
characters are removed.

### `GET /v1/issues/:id/activity`

The timeline of one issue: its actions and notes, the most recent first. Needs `issues:read`.
`limit` is 1 to 100 (the default is 25). The rows have the same fields as
[`GET /v1/activity`](#get-v1activity).

## Approvals

Approvals are off by default. To turn them on, set `REQUIRE_APPROVAL` (see
[Settings and health](settings.md)) to `ignore`, `merge`, or `ignore,merge`.

Then such an action is not done at once. The response is `202`:

```json
{"status": "approval_required", "approval_id": 7}
```

A person with the `admin` scope must approve the request. A request expires after 7 days.

### `GET /v1/approvals`

Lists the approval requests. Needs the `admin` scope. `limit` is 1 to 100 (the default is 25).

Each request has these fields: `id`, `action`, `issue_id`, `payload`, `requested_by`,
`requested_at`, `expires_at`, `status` (`pending`, `approved`, `rejected`, `expired` or
`failed`),
`decided_by` and `decided_at`.

### `POST /v1/approvals/:id/approve`

Approves the request and does the action. Needs the `admin` scope. Returns `200` with
`{"data": {"id": 7, "decision": "approve"}}`.

- `409` `{"error": "approval_not_pending"}`: the request is already decided, or it expired.
- `409` `{"error": "approval_failed", "reason": "..."}`: the issue changed after the request (for
  example, it was merged), so the action cannot run. The request gets the status `failed`.
- `403` `{"error": "forbidden", "reason": "A requester cannot approve its own request."}`: a
  token cannot approve its own request. The `ADMIN_TOKEN` can.

### `POST /v1/approvals/:id/reject`

Rejects the request. The action is not done. Needs the `admin` scope. The responses are the same
as for approve, with `"decision": "reject"`.

## Events

### `GET /v1/events/:id`

Returns one event. `:id` is the Checkend event ID (the `id` field), not the Sentry `event_id`.

The response has the same fields as the event list, and also `event`: the normalized event,
with secrets removed. The API never returns the raw payload.

## Tokens

All token endpoints need the `admin` scope.

### `POST /v1/tokens`

Creates a scoped token.

Body: `{"name": "claude-code", "scopes": ["issues:read"]}`. `name` has 1 to 100 characters.
`scopes` is a list of 1 to 4 scopes from the [scopes table](#scopes).

Returns `201`:

```json
{ "data": { "id": 1, "name": "claude-code", "scopes": ["issues:read"], "prefix": "ck_8Hq2xP0",
            "created_at": "...", "created_by": "...", "last_used_at": null, "revoked_at": null,
            "token": "ck_..." } }
```

The token is `ck_` and 43 more characters. **The token is only in this response.** Checkend
stores only its SHA-256 hash, so it cannot show the token again. `prefix` is the first 10
characters of the token: use it to find a token in the list.

### `GET /v1/tokens`

Lists the tokens. The list does not include the tokens or their hashes. `last_used_at` is
updated at most once per hour.

### `DELETE /v1/tokens/:id`

Revokes a token. Returns `204`, or `404` when the token is unknown or already revoked. A revoked
token gets `401`.

## Activity

### `GET /v1/activity`

The audit timeline, the most recent first. Needs the `admin` scope. `limit` is 1 to 100 (the
default is 25).

Each row has these fields: `id`, `at`, `actor_type` (`token`, `admin_token` or `system`),
`actor_id`, `actor_name`, `action`, `target_type`, `target_id` and `data` (JSON or `null`).

The actions are:

| Action | When |
|---|---|
| `token.create`, `token.revoke` | A token is created or revoked. |
| `project.create` | A project is created. `target_id` is the public project ID. |
| `issue.resolve`, `issue.ignore`, `issue.unresolve` | The status of an issue changes. `data` is `{"from": ..., "to": ...}`. |
| `issue.merge` | Issues are merged. `data` is `{"source_ids": [...]}`. |
| `issue.split` | Events are split off this issue. `data` is `{"new_issue_id": ..., "event_ids": [...]}`. |
| `issue.split_from` | This issue was made by a split. `data` is `{"issue_id": ...}` (the original issue). |
| `issue.claim` | An issue is claimed. `data` is `{"minutes": ..., "expires_at": ...}`. |
| `issue.release` | A claim is released. |
| `issue.note` | A note is added. `data` is `{"text": ...}`. |
| `issue.regress` | A new event arrives for a resolved issue, so it becomes unresolved. The actor is `system`, with the name `ingest`. |
| `approval.request`, `approval.approve`, `approval.reject` | An approval is requested or decided. |

## Triage labels

### `GET /v1/labels`

The triage history: the decisions that agents and people made on issues, and their
corrections, the most recent first. Needs the `admin` scope.

| Query parameter | Values |
|---|---|
| `limit` | 1 to 1000. The default is 100. |
| `since` | Labels at or after this time: a duration (for example `30m`, `24h` or `7d`) or an ISO time. |

Each row has these fields: `id` (the activity ID), `at`, `issue_id`, `label`, `actor_type`,
`actor_name`, `data` and `corrects`.

- `label` is `resolved`, `ignored`, `unresolved`, `regressed`, `merged` or `split`.
- `corrects` is the earlier decision that this row reverses:
  - `unresolved` and `regressed` reverse `resolved` or `ignored`. `corrects` is then `resolved`
    or `ignored`, or `null` when there was nothing to reverse.
  - A split corrects the grouping: `corrects` is `grouping`.
  - On other rows, `corrects` is `null`.

For example, an agent resolves an issue, and then a new event arrives. The row with the label
`regressed` (`actor_type` `system`, `actor_name` `ingest`) has `corrects` `resolved`: the resolve
was wrong.

The labels come from the [activity timeline](#activity), so they always agree with it. Notes and
claims are not labels. With the activity and the labels, a team can see each decision, and how
often the decisions of agents are corrected.

## Example

```sh
curl -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  "$CHECKEND_URL/v1/issues?status=unresolved&limit=10"
```
