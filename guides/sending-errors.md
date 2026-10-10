# Send errors

Checkend receives errors with the Sentry protocol. Checkend is Sentry SDK compatible: any Sentry
SDK can send to a Checkend DSN. You do not need a special SDK.

## Endpoints

| Endpoint | Used by |
|---|---|
| `POST /api/<project-id>/envelope/` | Current Sentry SDKs (envelope format). |
| `POST /api/<project-id>/store/` | Older SDKs (one JSON event). |

The trailing slash is optional.

## The DSN key

Each request must include the public key of the DSN. Checkend reads it from one of these places:

1. the `X-Sentry-Auth` header (`Sentry sentry_key=<key>, ...`)
2. the `sentry_key` query parameter
3. the `dsn` field in the envelope header. Tunnels (a proxy in your own app) use this.

The DSN key identifies a project. It is not a secret: browser apps include it in their code. It
only lets a client send events. It does not give read access. The read API uses a separate
admin token.

## What Checkend keeps

Checkend keeps **error events**: exceptions, and messages from `captureMessage`.

Checkend drops all other items: sessions, transactions, client reports and attachments.

## Responses

| Status | Meaning |
|---|---|
| `200` with `{"id": "<event_id>"}` | Checkend accepted the event. |
| `200` with `{}` | The request had no error event (for example, only a session). Nothing is kept. |
| `400` | The body is empty, or it is not valid. |
| `401` | The DSN key is missing, not valid, or not for this project. |
| `404` | The project ID is not a number. |
| `413` | The body or the event is too large (see the limits below). |
| `415` | Checkend does not accept this `Content-Type` or `Content-Encoding`. |
| `429` | Too many requests. Wait for the time in `Retry-After`, then send again. |

The response comes before the write to the database. Checkend writes the event after the
response (with `ctx.waitUntil`). The write is one atomic batch: all of it applies, or none of it
applies. A failed write is tried up to 3 times.

## Limits on requests

| Limit | Value |
|---|---|
| Request body, as sent | 1 MB |
| Request body, after decompression | 2 MB |
| One event | 1 MB |
| Items in one envelope | 100 |

Accepted `Content-Encoding`: none, `gzip` and `deflate`.

Accepted `Content-Type`: none, `application/x-sentry-envelope`, `text/plain`, `application/json`
and `application/octet-stream`. Sentry SDKs use these types.

## Back-pressure (429)

Checkend answers `429` with the `Retry-After` and `X-Sentry-Rate-Limits` headers in these cases:

- **A DSN key sends too much.** The limit is 1000 requests a minute for each DSN key. It needs the
  `INGEST_RATE_LIMITER` binding, which `wrangler.jsonc` includes. Without the binding, there is no
  rate limit.
- **One client IP causes too many key lookups in the database.** The same binding sets this limit.
- **The database is overloaded.** After 3 failed writes in a row, or one write that takes more
  than 5 seconds, Checkend answers `429` for 30 seconds.

Sentry SDKs read these headers and wait before they send again. Each Worker instance keeps its
own count of failed writes.

## Next

- [What Checkend stores](what-checkend-stores.md): what happens to an event after it is accepted.
- [Settings and health](settings.md): limits that you can change.
