# Settings and health

## Settings

All settings are optional. Set them as Workers secrets or variables (in your
`wrangler.<name>.jsonc` or in the Cloudflare dashboard).

| Name | Default | What it does |
|---|---|---|
| `ADMIN_TOKEN` (secret) | none | The bearer token for the `/v1` API. Without it, the API rejects all requests. |
| `D1_DAILY_ROW_LIMIT` | none | Turns on budget mode (see below). |
| `EVENTS_PER_ISSUE` | 100 | Stored events per issue. |
| `NEW_ISSUES_PER_HOUR` | 100 | New issues per project per hour. More go into one "flood" issue. |
| `TAG_KEYS_PER_PROJECT` | 200 | Different tag keys per project. |
| `INGEST_RATE_LIMITER` (binding) | 1000 requests a minute per DSN key | A Rate Limiting binding. `wrangler.jsonc` includes it. Without it, ingest has no rate limit. |

Set the secret with Wrangler:

```sh
npx wrangler secret put ADMIN_TOKEN --config wrangler.<name>.jsonc
```

For local development, put `ADMIN_TOKEN=...` in `.dev.vars`. This file is git-ignored.

## Budget mode (Workers Free plan)

The Workers Free plan limits how many rows D1 can write each day. If Checkend writes too many
rows, D1 stops all writes until the next day.

To prevent this, set:

```
D1_DAILY_ROW_LIMIT=100000
```

Checkend estimates the rows that it writes: 8 rows for a stored event, 4 rows for a counted
event, and 1 row for each new tag key. This is an estimate, not the real count from D1. Each
Worker instance reads the count again at most every 30 seconds.

When the estimate reaches 80% of this limit, it goes into **budget mode** until 00:00 UTC. In
budget mode, Checkend still counts events, but it does not store them. `/health` and the API
show the mode as `counters_only`.

## Health

`GET /health` needs no token. It returns the state of the install:

```json
{
  "status": "ok",
  "version": "0.0.0",
  "migrations": { "level": 2, "latest": "0002_ingest.sql", "applied": 2 },
  "ingest": { "mode": "full", "write_failures_today": 0, "retry_after_seconds": 0 },
  "time": "2026-10-10T12:00:00.000Z"
}
```

| Field | Meaning |
|---|---|
| `status` | `ok`, or `error` when the database cannot be read. |
| `version` | The Checkend version. |
| `migrations` | The last migration that is applied. |
| `ingest` | `null` before migration `0002`, or when the ingest tables cannot be read. |
| `ingest.mode` | `full`, or `counters_only` in budget mode. |
| `ingest.write_failures_today` | Writes that failed today, after all tries. |
| `ingest.retry_after_seconds` | More than 0 when the database is overloaded and ingest answers `429`. Each Worker instance keeps this value in memory, so another instance can show 0. |
| `time` | The time on the server. |

When the database cannot be read, `/health` returns `503`. The response has no error details,
because `/health` is public.

## Ingest state

`GET /v1/issues` also returns the ingest state in the `ingest` field. It has more fields than
`/health`:

| Field | Meaning |
|---|---|
| `mode` | `full` or `counters_only`. |
| `rows_written_today` | The estimate of rows written to D1 today (UTC). See [Budget mode](#budget-mode-workers-free-plan). |
| `daily_row_limit` | The value of `D1_DAILY_ROW_LIMIT`, or `null`. |
| `events_received_today` | Events that reached the write today, also events that were only counted. Rejected requests (`4xx`) and failed writes are not counted. |
| `write_failures_today` | Writes that failed today. |
| `retry_after_seconds` | As in `/health`. |
