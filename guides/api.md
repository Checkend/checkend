# API

The Checkend API returns JSON. All endpoints start with `/v1`.

## Authentication

Each request needs the admin token in a header:

```
Authorization: Bearer <ADMIN_TOKEN>
```

`ADMIN_TOKEN` is a secret of the Worker (see [Settings and health](settings.md)). If the Worker
has no `ADMIN_TOKEN`, every API request gets `401`.

There is one admin token for now. It can read all data and create projects. Keep it secret.

## Errors

| Status | Body |
|---|---|
| `400` | `{"error": "invalid_request", "details": [{"path": ..., "message": ...}]}` |
| `401` | `{"error": "unauthorized"}` |
| `404` | `{"error": "not_found"}` |

## Projects

### `GET /v1/projects`

Lists all projects, with their DSNs.

```json
{ "data": [ { "id": 1, "name": "My App", "slug": "my-app", "platform": "node",
              "created_at": "...", "dsns": ["https://<key>@<host>/1"] } ] }
```

### `POST /v1/projects`

Creates a project and its DSN.

Body: `{"name": "My App", "platform": "node"}`. `name` has 1 to 100 characters. `platform` is
optional (32 characters or fewer).

Returns `201`:

```json
{ "data": { "id": 1, "name": "My App", "slug": "my-app", "platform": "node",
            "created_at": "...", "dsn": "https://<key>@<host>/1" } }
```

The [project CLI](quick-start.md#3-create-a-project-and-get-a-dsn) calls these two endpoints.

## Issues

### `GET /v1/issues`

Lists issues. The issue with the most recent event comes first.

| Query parameter | Values |
|---|---|
| `project` | A project ID. |
| `status` | `unresolved`, `resolved` or `ignored`. |
| `limit` | 1 to 100. The default is 25. |
| `cursor` | The `next_cursor` from the previous page. |

```json
{ "data": [ ... ], "next_cursor": "..." , "ingest": { ... } }
```

`next_cursor` is `null` on the last page. `ingest` is the ingest state (see
[Settings and health](settings.md#ingest-state)).

Each issue has these fields: `id`, `project_id`, `title`, `culprit`, `type`, `level`, `platform`,
`status`, `times_seen`, `stored_events`, `first_seen`, `last_seen`, `first_release`,
`last_release`, `fingerprint` and `fingerprint_version`.

`times_seen` counts all events. `stored_events` counts the events that Checkend stored (see the
[caps](what-checkend-stores.md#4-caps-per-project)).

### `GET /v1/issues/:id`

Returns one issue, with one more field: `latest_event_id`, the ID of its most recent stored event.

### `GET /v1/issues/:id/events`

Lists the stored events of an issue, the most recent first. `limit` is 1 to 100 (the default is
25).

Each event has these fields: `id`, `issue_id`, `project_id`, `event_id`, `timestamp`,
`received_at`, `level`, `release` and `environment`.

## Events

### `GET /v1/events/:id`

Returns one event. `:id` is the Checkend event ID (the `id` field), not the Sentry `event_id`.

The response has the same fields as the event list, and also `event`: the normalized event,
with secrets removed. The API never returns the raw payload.

## Example

```sh
curl -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  "$CHECKEND_URL/v1/issues?status=unresolved&limit=10"
```
