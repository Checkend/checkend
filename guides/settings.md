# Settings and health

## Settings

All settings are optional. Set them as Workers secrets or variables (in your
`wrangler.<name>.jsonc` or in the Cloudflare dashboard).

| Name | Default | What it does |
|---|---|---|
| `ADMIN_TOKEN` (secret) | none | The bootstrap admin token for `/v1`. It has all scopes. Use it to create [scoped tokens](api.md#tokens). It needs at least 32 characters, for example `openssl rand -hex 32`; a shorter one is ignored, and the logs say why. |
| `D1_DAILY_ROW_LIMIT` | none | Turns on budget mode (see below). |
| `EVENTS_PER_ISSUE` | 100 | Stored events per issue. |
| `NEW_ISSUES_PER_HOUR` | 100 | New issues per project per hour. More go into one "flood" issue. |
| `TAG_KEYS_PER_PROJECT` | 200 | Different tag keys per project. |
| `VERIFY_QUIET_HOURS` | 24 | Hours without the error, after the deploy, before a fix is verified. See [Verify fixes](fix-loop.md). |
| `GITHUB_TOKEN` (secret) | none | Optional. A GitHub token that can read the repository contents (a fine-grained token with "Contents: Read-only"). Checkend uses it to get the commits of each deploy, for [suspect commits](fix-loop.md#suspect-commits). |
| `GITHUB_WEBHOOK_SECRET` (secret) | none | The secret of the [GitHub webhook](fix-loop.md#or-use-the-github-webhook). Without it, the webhook is off. |
| `ENCRYPTION_KEYS` (secret) | none | The keys that encrypt stored secrets, for example `k2:<base64>,k1:<base64>`, the current key first. [Webhooks](webhooks.md) need it. See [Encryption keys](webhooks.md#encryption-keys). |
| `BLOBS` (binding) | none | An R2 bucket for [source maps](source-maps.md) and for large [raw payloads](what-checkend-stores.md#5-the-raw-payload). Without it, source map uploads give `400` `storage_not_configured`, and raw payloads above 64 KB (compressed) are not kept. |
| `INGEST_QUEUE` (binding) | none | Optional overflow queue for events when D1 is overloaded. See [Bursts and overload](sending-errors.md#bursts-and-overload). |
| `EMAIL` (binding) | none | The Cloudflare Email Service binding (`"send_email": [{"name": "EMAIL"}]`) for [email alerts](alerts.md#email). |
| `EMAIL_FROM` | none | The sender of email alerts: an address on a domain that is onboarded to the Email Service. Email alerts need it and `EMAIL`. |
| `NOTIFY` (binding) | none | Optional Cloudflare Queue for webhook deliveries. Without it, deliveries work. |
| `RETENTION_DAYS` | 90 | Days that Checkend keeps stored events and hourly counts (hourly counts at least 8 days). See [Data retention](#data-retention). |
| `REQUIRE_APPROVAL` | none | Actions that need a person's approval: a comma-separated list of `ignore`, `merge` and `delete_project`. See [Approvals](api.md#approvals). |
| `AI_TRIAGE` | off | `on`: triage issues with a Workers AI model. See [AI triage](ai-triage.md). |
| `AI_GATEWAY_ID` | `default` | The AI Gateway for all model calls. |
| `AI_GATEWAY_LOGS` | off | `on`: the gateway stores the prompts and the responses. |
| `AI_SIMILAR` | off | `on`: find [similar issues](ai-triage.md#similar-issues). On Cloudflare, it also needs the `VECTORIZE` binding. |
| `INGEST_RATE_LIMITER` (binding) | none | Optional: a rate limit for each DSN key (1000 requests a minute in the block below). Without it, Cloudflare has no limit for each key, but quotas and budget mode still work. |

Set the secret with Wrangler:

```sh
npx wrangler secret put ADMIN_TOKEN --config wrangler.<name>.jsonc
```

For local development, put `ADMIN_TOKEN=...` in `.dev.vars`. This file is git-ignored.

On Node (Docker), there are more settings, for example `DATABASE_PATH`. See
[Run without Cloudflare](self-host.md#settings).

## Optional Cloudflare bindings

The root `wrangler.jsonc` has only what a new Workers Free account can deploy: D1 and one Cron
Trigger. Checkend finds the other bindings at runtime and works without them. To add one, add its
block to your Worker config (`wrangler.<name>.jsonc`), then deploy.

A rate limit for each DSN key:

```jsonc
"ratelimits": [
  { "name": "INGEST_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 1000, "period": 60 } }
]
```

R2 for source maps and large raw payloads (see [Source maps](source-maps.md#set-up-storage)):

```jsonc
"r2_buckets": [{ "binding": "BLOBS", "bucket_name": "checkend-blobs" }]
```

The overflow queue (see [Bursts and overload](sending-errors.md#bursts-and-overload)):

```jsonc
"queues": {
  "producers": [{ "binding": "INGEST_QUEUE", "queue": "checkend-ingest" }],
  "consumers": [{ "queue": "checkend-ingest" }]
}
```

Workers AI for [AI triage](ai-triage.md):

```jsonc
"ai": { "binding": "AI" }
```

A Vectorize index for [similar issues](ai-triage.md#similar-issues) (make it with
`npx wrangler vectorize create checkend-issues --dimensions=1024 --metric=cosine`):

```jsonc
"vectorize": [{ "binding": "VECTORIZE", "index_name": "checkend-issues" }]
```

Email alerts (see [Alerts](alerts.md#email)), with the variable `EMAIL_FROM`:

```jsonc
"send_email": [{ "name": "EMAIL" }]
```

## Budget mode (Workers Free plan)

The Workers Free plan limits how many rows D1 can write each day. If Checkend writes too many
rows, D1 stops all writes until the next day.

To prevent this, set:

```
D1_DAILY_ROW_LIMIT=100000
```

Checkend estimates the rows that it writes: 10 rows for a stored event, 6 rows for a counted
event, 2 more rows for an event with a user, and 1 row for each new tag key. This is an estimate, not the real count from D1. Each
Worker instance reads the count again at most every 30 seconds.

When the estimate reaches 80% of this limit, it goes into **budget mode** until 00:00 UTC. In
budget mode, Checkend still counts events, but it does not store them. `/health` and the API
show the mode as `counters_only`.

## Data retention

Every 5 minutes, the cron deletes data that is older than `RETENTION_DAYS` (90 by default):

- stored events, with their raw payloads (also the ones in `BLOBS`)
- hourly counts
- the records of pushed commits
- finished webhook deliveries (delivered or failed), after 30 days. Pending deliveries stay.

Checkend keeps the issues (with their total `times_seen`), the activity timeline (the audit
record), and the user hashes behind `users_affected`.

Hourly counts stay for at least 8 days, also when `RETENTION_DAYS` is shorter, because
`events_7d` and the priority score use them.

To keep each run small in D1 row writes, Checkend deletes in chunks: 500 rows, at most 4 chunks in
each run. A large backlog, for example after you lower `RETENTION_DAYS`, goes away over several
runs. After it deletes events, Checkend updates the stored-event counts of the issues.

## Health

`GET /health` needs no token. It returns the state of the install:

```json
{
  "status": "ok",
  "version": "0.0.0",
  "migrations": { "level": 3, "latest": "0003_tokens_activity_public_ids.sql", "applied": 3 },
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
