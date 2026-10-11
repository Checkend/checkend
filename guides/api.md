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
| `issues:read` | `GET /v1/projects`, `/v1/issues`, `/v1/issues/:id`, `/v1/issues/:id/events`, `/v1/issues/:id/activity`, `/v1/events/:id`, `/v1/releases`, `/v1/releases/:version`, `/v1/sourcemaps`, `/v1/alerts`, and `POST /v1/similar` |
| `issues:write` | `POST /v1/issues/:id/resolve`, `/ignore`, `/unresolve`, `/merge`, `/split`, `/fix`, `/triage-correction`, `/claim`, `/release` and `/notes`, `DELETE /v1/issues/:id/claim`, and the MCP tools that change issues |
| `admin` | All scopes, and also `POST /v1/projects`, `PATCH /v1/projects/:project`, `DELETE /v1/projects/:project`, `POST` and `DELETE /v1/projects/:project/keys`, `POST`, `GET` and `DELETE /v1/setup/keys`, `GET /v1/setup/progress`, `POST /v1/setup/apps`, `/v1/setup/tokens`, `/test-event` and `/report` (the setup routes also take a setup key), `GET` and `POST /v1/tokens`, `DELETE /v1/tokens/:id`, `GET /v1/activity`, `GET /v1/labels`, `GET /v1/fix-outcomes`, `GET /v1/approvals`, `POST /v1/approvals/:id/approve` and `/reject`, and all `/v1/webhooks` endpoints |
| `releases:write` | `POST /v1/deploys`, `POST /v1/sourcemaps`, `DELETE /v1/sourcemaps/:id` |

A coding agent that only reads errors needs `issues:read`. An agent that also resolves,
ignores or merges issues needs `["issues:read", "issues:write"]`. Coding agents can also use the
[MCP server](mcp.md).

The OpenAPI 3.1 document of this API is at `GET /v1/openapi.json`. It needs no token. Each
operation has `x-required-scope`.

## Errors

| Status | Body |
|---|---|
| `400` | `{"error": "invalid_request", "details": [{"path": ..., "message": ...}]}` |
| `401` | `{"error": "unauthorized"}`, with the header `WWW-Authenticate: Bearer`. The token is missing, not valid, or revoked. Checkend answers before it reads the body. |
| `403` | `{"error": "forbidden", "required_scope": "<scope>"}`. The token does not have the scope that the endpoint needs. |
| `404` | `{"error": "not_found"}`, or `{"error": "project_not_found"}` when the `?project=` value matches no project. |
| `413` | `{"error": "payload_too_large", "max_bytes": N}`. A JSON body of `/v1`, `/v1/setup` or `/mcp` is at most 1 MB; a source map upload is at most 30 MB. The cap also holds for a chunked body without `Content-Length`. |

## Projects

Each project has a public ID: a random number with 10 digits, for example `4821937065`. The IDs
are not in order. The DSN, the ingest URL and the API use only this ID. It is a number, because
Sentry SDKs accept only digits as the project ID of a DSN.

### `GET /v1/projects`

Lists all projects, with their DSNs. Each project also has:

- `repository`: `owner/name`, or `null`
- `trust`: the [trust level](sending-errors.md#trust-and-allowed-origins) now, `low` or `high`
- `trust_setting`: `low`, `high`, or `null` (automatic)
- `allowed_origins`: a list of origins, or `null` (any origin)
- `daily_quota`: the daily event quota, or `null` (no quota)
- `scrub_keys` and `scrub_patterns`: the [scrub settings](what-checkend-stores.md#your-own-scrub-rules) of the project
- `events_24h` and `last_event_at`: the events of the last 24 hours, and the time of the last event
- `demo`: true for a demo project
- `events_today`: the events of the project since 00:00 UTC (a repeated `event_id` counts once)

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

### `PATCH /v1/projects/:project`

Changes the settings of a project. Needs the `admin` scope. `:project` is the public project ID
or the slug. The body has one or more of these fields:

| Field | Value |
|---|---|
| `repository` | `"owner/name"`, or `null` to remove it. Checkend stores it in lowercase. It is used by the [GitHub webhook](fix-loop.md#or-use-the-github-webhook), and a linked pull request must be in this repository. |
| `trust` | `"low"`, `"high"`, or `null` for automatic. See [Trust and allowed origins](sending-errors.md#trust-and-allowed-origins). |
| `daily_quota` | 1 to 1,000,000,000 events each day (UTC), or `null` to remove the quota (the default). Other values give `400`. At the quota, ingest answers `429` until 00:00 UTC (see [Back-pressure](sending-errors.md#back-pressure-429)). A change takes effect within 60 seconds. |
| `scrub_keys` | Up to 50 key names (letters, digits, `_`, `.` and `-`; any case). The value of any key with one of these names becomes `[Filtered]`. See [Your own scrub rules](what-checkend-stores.md#your-own-scrub-rules). |
| `scrub_patterns` | Up to 10 regular expressions (JavaScript syntax), each at most 200 characters. A pattern that fails the safety check gives `400` with the path `scrub_patterns.<index>` and the reason. Saving can take up to about a second. |
| `allowed_origins` | 1 to 20 origins (`scheme://host[:port]`, `http` or `https`, no path, no wildcard; stored in lowercase), or `null` for any origin. |

Other fields or values give `400`. An unknown project gives `404`. Returns the project, as in
`GET /v1/projects`. The activity row `project.update` has the changed fields.

### `DELETE /v1/projects/:project`

Deletes a project. Needs the `admin` scope. Returns `204`, or `404` for an unknown project.

- The DSN keys of the project stop working within 60 seconds.
- The project is hidden everywhere at once, and its name can be used again.
- Pending alerts for its issues are not sent.
- The cron deletes its issues, events, counts, releases, deploys, source maps (with their blobs)
  and webhooks, in chunks.
- The activity timeline stays.
- Its fixes are not verified any more.
- The agent tokens bound to the project (made with a setup key for it) are revoked, each with a
  `token.revoke` activity row.

When `REQUIRE_APPROVAL` includes `delete_project`, an API token gets `202`
`{"status": "approval_required", ...}`, and another actor must complete the delete (see
[Approvals](#approvals)). There is no MCP tool to delete a project.

### `POST /v1/projects/:project/keys`

Adds a DSN key to a project, so that you can rotate the DSN. Needs the `admin` scope. Returns `201`
with `public_key` and the new `dsn`.

### `DELETE /v1/projects/:project/keys/:key`

Revokes a DSN key. Needs the `admin` scope. Events with the key get `401` within 60 seconds, on
every server. Returns `204`. The only active key of a project cannot be revoked (`409`
`{"error": "last_key"}`): add a new key first.

## Issues

### `GET /v1/issues`

Lists issues. By default, the issue with the most recent event comes first.

| Query parameter | Values |
|---|---|
| `project` | A project ID (for example `4821937065`) or a project slug (for example `my-app`). |
| `status` | `unresolved`, `resolved`, `ignored`, `merged`, `fix_pending`, `verified` or `regressed`. Without `status`, the list does not show merged issues. |
| `limit` | 1 to 100. The default is 25. |
| `cursor` | The `next_cursor` from the previous page. |
| `release` | Issues with this release: the first or last release of the issue, or a stored event. |
| `environment` | Issues with a stored event in this environment. |
| `since` | Issues last seen at or after this time: a duration (for example `30m`, `24h` or `7d`) or an ISO date or time. |
| `search` | Text in the title or the culprit, 200 characters at most. `%` and `_` are plain characters. |
| `claimed` | `true`: only issues with an active claim. `false`: only issues without one. |
| `test` | `true`: only [test issues](agent-setup.md#3-what-the-agent-does). Without it, the list leaves test issues out. |
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
`last_release`, `fingerprint`, `fingerprint_version`, `merged_into`, `claim` and `trust`.

- `events_24h` and `events_7d`: the events in the last 24 hours and the last 7 days. Checkend
  counts them per UTC hour, so each window is the full hours inside it.
- `users_affected`: the number of different users. The user of an event is its `user.id`, else
  `user.email`, else `user.username`, else `user.ip_address`. For this count, Checkend stores
  only a hash of the value. The count stops at 1,000 per issue. An event without a user adds no
  user.
- `priority`: the [priority score](#priority-score).
- `merged_into`: the ID of the issue that this issue was merged into, or `null`.
- `trust`: the [trust level](sending-errors.md#trust-and-allowed-origins) of the project, `low`
  or `high`.

An SDK that sends the same event again (the same `event_id`, while the event is stored) does not
make the counts go up twice. A merge moves the hourly counts and the users to the target issue.

`claim` is `{"holder": "agent-a", "expires_at": "..."}` when the issue has an active
[claim](#post-v1issuesidclaim), or `null`.

`times_seen` counts all events. `stored_events` counts the events that Checkend stored (see the
[caps](what-checkend-stores.md#4-caps-per-project)).

### `GET /v1/issues/:id`

Returns one issue, with two more fields:

- `latest_event_id`: the ID of its most recent stored event.
- `test`: `true` for the test issue of a setup (see [Set up with an agent](agent-setup.md#3-what-the-agent-does)).
- `fix`: the linked fix (see [Verify fixes](fix-loop.md)), or `null`. It has `kind`, `commit`
  or `pr_url`, `linked_by`, `linked_at`, `release`, `environment`, `deployed_at`, `outcome`
  (`null`, `verified` or `regressed`), `verified_at`, `regressed_at` and `regressed_in`.

### Priority score

The priority score (version 1) puts the issues that hurt the most users now at the top:

```
priority = (1 + users_affected) × (1 + events_24h) × recency × newness × regression
recency    = 1 / (1 + days since last seen)
newness    = 2 when the issue was first seen in the last 24 hours, else 1
regression = 2 when the issue is regressed, else 1
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

### `POST /v1/issues/:id/fix`

Links a fix to the issue (see [Verify fixes](fix-loop.md)). Body: `{"commit": "<SHA>"}` or
`{"pr_url": "https://github.com/<owner>/<repo>/pull/<number>"}`, exactly one of them. The SHA has
7 to 40 hex characters (Checkend stores it in lowercase). Returns `200` with the issue: its status
is `fix_pending`, and it has `fix`.

A new link replaces the open fix. When a deploy with this commit or pull request was already
reported, the fix counts as deployed at once. Both fields, another host, or `http` gives `400`.
When the project has a repository, a pull request in another repository also gives `400`: "The
pull request must be in the repository of the project: owner/name."
An unknown or merged issue gives `404`.

### `POST /v1/issues/:id/triage-correction`

Corrects the [AI triage](ai-triage.md#correct-the-triage) of an issue. Needs `issues:write`.
Body: at least one of `category`, `severity` (0 to 3), `transient`, `agent_fixable` and `noise`,
and an optional `note` (at most 500 characters). Returns `201` with
`{"data": {"recorded": true}}`, or `404`. The correction is a triage label `triage_corrected`.

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

## Releases and deploys

See [Verify fixes](fix-loop.md) for how deploys verify fixes.

### `POST /v1/deploys`

Reports a deploy. Needs the `releases:write` scope. Returns `201`.

| Field | Value |
|---|---|
| `project` | Required. The public project ID (a number or a string) or the slug. |
| `commit` | Required. The deployed commit SHA. |
| `release` | The release version. The default is the commit SHA. Checkend creates the release when it is first used. |
| `environment` | The default is `production`. |
| `commits` | Up to 1000 SHAs: the commits since the last deploy, for example from `git rev-list <previous>..HEAD`. |
| `pull_requests` | Up to 100 GitHub pull request URLs. |

A fix counts as deployed only when its commit is the deployed `commit` or is in `commits`, or
when its pull request is in `pull_requests`.

The response `data` has `id`, `project_id`, `release`, `environment`, `commit`, `deployed_at` and
`fixes_deployed` (the IDs of the issues whose fix this deploy contains). An unknown project gives
`404` `{"error": "project_not_found"}`.

### `POST /hooks/github`

The GitHub webhook (see [Verify fixes](fix-loop.md#or-use-the-github-webhook)). It is not under
`/v1`, and it does not use a bearer token: GitHub signs each request with the
`GITHUB_WEBHOOK_SECRET` (the `X-Hub-Signature-256` header). Without the secret, the endpoint
answers `404`.

| Status | When |
|---|---|
| `200` `{"ok": true, "projects": n, "commits": n}` | A push. |
| `200` `{"ok": true, "projects": n, "merged": "<url>"}` | A merged pull request. |
| `200` `{"ok": true, "deploys": [...]}` | A successful deployment. The deploys look like the response of `POST /v1/deploys`. |
| `200` `{"ok": true, "ignored": "..."}` | Another event, or no project has this repository. |
| `200` `{"ok": true, "duplicate": true}` | The same delivery again. |
| `400` | The body is not JSON. |
| `401` `{"error": "invalid_signature"}` | The signature is wrong or missing. |
| `413` | The body is larger than 2 MB. |

### `POST /v1/sourcemaps`

Uploads a source map. Needs `releases:write`. See [Source maps](source-maps.md).

| Query parameter | Value |
|---|---|
| `project` | Required. The public project ID or the slug. |
| `release` | Required. The release, the same as in the SDK. |
| `name` | Required. The minified file: its URL, `~/path` (any host), or a path. Checkend keeps the URL path. |

The body is the source map JSON (`Content-Type: application/json`), or a prebuilt index
(`application/x-checkend-sourcemap-index`). Other types give `415`. The body is at most 30 MB
(else `413`). A new upload for the same project, release and path replaces the old map.

Returns `201` with `id`, `project_id`, `release`, `name`, `path`, `size` (the bytes of the index),
`sources` (the number of original files in the map), `uploaded_at` and `uploaded_by`.

Errors:

- `400` `{"error": "invalid_sourcemap", "reason": "..."}`: not version 3, a map with `sections`
  (not supported), broken mappings, a broken index, or not JSON.
- `400` `storage_not_configured`: the Worker has no `BLOBS` bucket.
- `400` `invalid_request`: a query parameter is missing.
- `404` `project_not_found`.

### `GET /v1/sourcemaps`

Lists the source maps, the most recent first. Needs `issues:read`. Query: `project` (required)
and `release` (optional). An unknown project gives `404` `project_not_found`.

### `DELETE /v1/sourcemaps/:id`

Deletes a source map. Needs `releases:write`. Returns `200` with
`{"data": {"id": ..., "deleted": true}}`, or `404` for an unknown source map.

### `GET /v1/releases`

Lists the releases, the most recently deployed first. Needs `issues:read`. Query: `project`
(optional) and `limit` (1 to 100, the default is 25).

Each release has `project_id`, `version`, `commit`, `created_at` and `deploys` (the latest
first). Each deploy has `id`, `environment`, `commit`, `source` and `deployed_at`.

### `GET /v1/releases/:version`

One release. Needs `issues:read`. The `project` query parameter is required. URL-encode the
version. The response has the release and its deploys, and also `new_issue_ids` (the issues
first seen in this release), `fixes_deployed` (each with `issue_id`, `kind`, `ref` and
`outcome`) and `regressed_issue_ids`. An unknown release gives `404`.

### `POST /v1/similar`

Searches for [similar issues](ai-triage.md#similar-issues). Needs `issues:read`. Body: an
`issue_id` or a `text`, and `limit` (1 to 20). When the feature is off, the response is `409`
`{"error": "similar_off", ...}`.

### `GET /v1/fix-outcomes`

The fixes that have an outcome (`verified` or `regressed`), the most recent first. Needs the
`admin` scope. Query: `limit` (1 to 1000, the default is 100) and `since` (a duration or an ISO
time).

Each row has `fix_id`, `issue_id`, `kind`, `ref`, `linked_by_type`, `linked_by`, `linked_at`,
`deployed_at`, `outcome`, `verified_at`, `regressed_at`, `regressed_in`, `hours_to_verified`
(from the link) and `hours_to_fix` (from the first event of the issue). A fix that was verified
and then regressed has the outcome `regressed`, and it still has `verified_at`.

## Webhooks

Outgoing webhooks call your URL for `issue.new`, `issue.regressed` and `issue.verified`. See
[Webhooks](webhooks.md) for the request, the signature and the retries. All these endpoints need
the `admin` scope.

### `POST /v1/webhooks`

Creates a webhook or an [alert](alerts.md). Other fields give `400`.

| Field | Value |
|---|---|
| `name` | 1 to 100 characters. |
| `format` | `checkend` (the default), `github_dispatch`, `slack`, `discord`, `github_issue` or `email`. |
| `url` | The target. Not for `email`. For `github_dispatch`: `https://api.github.com/repos/<owner>/<repo>/dispatches`; for `github_issue`: `https://api.github.com/repos/<owner>/<repo>/issues`; for `slack`: `https://hooks.slack.com/services/...`; for `discord`: `https://discord.com/api/webhooks/<id>/<token>`. Slack and Discord URLs are stored encrypted and shown masked. |
| `to` | For `email` only: 1 to 20 addresses. |
| `github_token` | For `github_dispatch` and `github_issue` only, and required for them. Stored encrypted and never returned. |
| `events` | One or more of `issue.new`, `issue.regressed`, `issue.verified` and `issue.spike`. |
| `spike_threshold` | 1 to 1,000,000. Required with `issue.spike`, and only with it. |
| `min_trust` | `high` (the default) or `low`. |
| `project` | A public ID or slug. The default is all projects. |

See [Start an agent from GitHub Actions](webhooks.md#start-an-agent-from-github-actions) and
[Alerts](alerts.md).

Returns `201` with `id`, `name`, `url`, `format`, `events`, `min_trust`, `project_id`,
`created_at`, `created_by`, `last_delivery_status` and `secret` (`whsec_...`). **The secret is
only in this response.**

Errors:

- `400` `{"error": "encryption_not_configured", "reason": "Set ENCRYPTION_KEYS: ..."}`: the
  Worker has no [encryption keys](webhooks.md#encryption-keys).
- `400` `{"error": "email_not_configured"}`: an `email` alert, but the Worker has no
  [email settings](alerts.md#email).
- `400` `invalid_request` with the path `url` (the reason, see the
  [URL rules](webhooks.md#url-rules)), `to`, `project`, `github_token` or `spike_threshold`.

### `GET /v1/alerts`

Lists the webhooks and alerts for agents and people who are not admins. Needs `issues:read`. It
does not show secrets, email addresses (only their number), or the query strings of URLs. The
MCP tool `list_alerts` returns the same list.

### `GET /v1/webhooks`

Lists the webhooks, without their secrets.

### `DELETE /v1/webhooks/:id`

Deletes a webhook. Its pending deliveries fail. An unknown webhook gives `404`.

### `POST /v1/webhooks/:id/test`

Sends a `ping` event (`issue` and `brief` are `null`). Returns `202` with `{"delivery_id": ...}`.

### `GET /v1/webhooks/:id/deliveries`

Lists the deliveries of a webhook, the most recent first. `limit` is 1 to 100 (the default is
25). Each delivery has `id`, `event`, `issue_id`, `status` (`pending`, `delivered` or `failed`),
`attempts`, `last_status` (the HTTP status), `last_error`, `created_at`, `next_attempt_at` and
`delivered_at`.

## Setup

The onboarding API, for a coding agent that sets up Checkend in your apps. See
[Set up with an agent](agent-setup.md). These routes take a setup key (`cks_...`), or a token with
the `admin` scope. The report route also takes the agent token of that app (its own app only).
Other tokens get `403`. In the OpenAPI document, the setup key is the security scheme
`setupKey`.

### `POST /v1/setup/keys`

Makes a setup key. Needs the `admin` scope (a setup key cannot make one). The key lasts 1 hour,
and Checkend stores only its hash. `GET /v1/setup/keys` lists the keys, and
`DELETE /v1/setup/keys/:id` revokes one, and also the agent tokens that it made (each with a
`token.revoke` activity row).

### `POST /v1/setup/apps`

Registers an app: `{"name": "...", "platform": "..."}` (`platform` is optional). Returns `201`
with `created`, `project` and `dsn`, or `200` on a retry with the same name. A setup key can
register at most 10 apps (then `429`).

### `POST /v1/setup/tokens`

Makes an agent token for an app: `{"name": "...", "project": ...}`. The token has `issues:read`
and `issues:write` on every project of the install, not only on its own app. It does not expire.
It is revoked with its setup key, with its project, or with `DELETE /v1/tokens/:id`. A setup key can make at most 5 tokens (then `429`).

### `POST /v1/setup/apps/:project/test-event`

Sends the one test event of the app (with the tag `checkend.test=true`). Returns `202`, or `409`
when the app already has its test event. An app that is not one of the apps of the setup key
gives `404`.

### `POST /v1/setup/apps/:project/report`

Reports a setup step: `{"step": "sdk_installed"}`. Returns `204`. The agent token that the setup
made for this app can also report it. An app that is not one of the apps of the setup key gives
`404`; with an agent token, another app gives `403`.

### `GET /v1/setup/progress`

The progress of each app: `connected_at`, `sdk_installed_at`, `test_event_at`, `first_event_at`,
`agent` and `first_deploy_at` (see [Follow the progress](agent-setup.md#4-follow-the-progress)),
and `setup_keys_active`. A setup key sees only its own apps. It needs a setup key or the `admin`
scope.

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
`{"error": "not_claim_holder", "claim": {"holder": "agent-a", "expires_at": "..."}}`.
When the issue has no active claim, the response is `200`.

### `DELETE /v1/issues/:id/claim`

The same as [`POST /v1/issues/:id/release`](#post-v1issuesidrelease), with the same responses.

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
[Settings and health](settings.md)) to a list of `ignore`, `merge` and `delete_project`, for
example `ignore,merge`. For `delete_project`, see
[`DELETE /v1/projects/:project`](#delete-v1projectsproject).

Then such an action is not done at once. The response is `202`:

```json
{"status": "approval_required", "approval_id": 7}
```

Another actor with the `admin` scope must decide the request: a second admin token, or a person
in the web UI. No actor approves or rejects its own request, the `ADMIN_TOKEN` included, for
every kind of action. A request expires after 7 days.

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
- `403` `{"error": "forbidden", "reason": "A requester cannot approve its own request."}`: the
  request is your own. This also holds for the `ADMIN_TOKEN`.

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
| `issue.regress` | A new event arrives for a resolved issue, so it becomes unresolved; or the error comes back in a release that contains the fix, so the issue becomes regressed. The actor is `system`, with the name `ingest`. |
| `issue.fix` | A fix is linked. `data` has `kind`, `ref`, `from` and `to`. |
| `issue.fix_deployed` | A deploy contains the fix. `data` has `release`, `environment` and `fix_id`. |
| `issue.verify` | The fix is verified. The actor is `system`, with the name `verifier`. |
| `release.deploy` | A deploy is reported. `target_type` is `release`. |
| `sourcemap.upload` | A source map is uploaded. `target_type` is `project`; `data` has `release`, `name` and `size`. |
| `sourcemap.delete` | A source map is deleted. |
| `webhook.create` | A webhook is created. `data` has `name` and `url`. |
| `webhook.delete` | A webhook is deleted. |
| `project.update` | The settings of a project change (`repository`, `trust`, `allowed_origins`, `daily_quota`, `scrub_keys` or `scrub_patterns`). `data` has the changed fields. |
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

- `label` is `resolved`, `ignored`, `unresolved`, `regressed`, `merged`, `split` or
  `triage_corrected`.
- `corrects` is the earlier decision that this row reverses:
  - `unresolved` and `regressed` reverse `resolved` or `ignored`. `corrects` is then `resolved`
    or `ignored`, or `null` when there was nothing to reverse.
  - A split corrects the grouping: `corrects` is `grouping`.
  - A triage correction corrects the AI triage: `corrects` is `triage`. Its `data` keeps the
    model answer of that time.
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
