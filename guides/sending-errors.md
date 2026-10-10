# Send errors

Checkend receives errors with the Sentry protocol. Checkend is Sentry SDK compatible: any Sentry
SDK can send to a Checkend DSN. You do not need a special SDK. Without a Sentry SDK, use the
[native JSON endpoint](#native-json-ingest).

## Endpoints

| Endpoint | Used by |
|---|---|
| `POST /api/<project-id>/envelope/` | Current Sentry SDKs (envelope format). |
| `POST /api/<project-id>/store/` | Older SDKs (one JSON event). |
| `POST /v1/ingest?project=<project>` | curl, scripts and other languages: [native JSON](#native-json-ingest). |

The trailing slash is optional.

## The DSN key

Each request must include the public key of the DSN. Checkend reads it from one of these places:

1. the `X-Sentry-Auth` header (`Sentry sentry_key=<key>, ...`)
2. the `sentry_key` query parameter
3. the `dsn` field in the envelope header. Tunnels (a proxy in your own app) use this.

The DSN key identifies a project. It is not a secret: browser apps include it in their code. It
only lets a client send events. It does not give read access. The read API uses separate bearer
tokens.

## What Checkend keeps

Checkend keeps **error events**: exceptions, and messages from `captureMessage`.

Checkend drops all other items: sessions, transactions, client reports and attachments.

## Responses

| Status | Meaning |
|---|---|
| `200` with `{"id": "<event_id>"}` | Checkend accepted the event. |
| `200` with `{}` | The request had no error event (for example, only a session). Nothing is kept. |
| `400` | The body is empty, or it is not valid. |
| `401` | The DSN key is missing, not valid, or not for this project, or the project ID is unknown. |
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

## Native JSON ingest

For curl, scripts, and languages without a Sentry SDK, Checkend has a simple JSON endpoint:

```
POST /v1/ingest?project=<public project ID or slug>
```

It uses the DSN key in the `X-Checkend-Key` header: the 32 hex characters before the `@` in the
DSN. It does not use a bearer token, and the key never gives read access. Checkend does not read
the key from the URL, because URLs end up in logs, so `?sentry_key=` does not work here.

```sh
curl -X POST "$CHECKEND_URL/v1/ingest?project=my-app" \
  -H "X-Checkend-Key: <key>" \
  -H "Content-Type: application/json" \
  -d '{"type": "TypeError", "message": "x is undefined", "release": "app@1.2.3",
       "frames": [{"file": "src/cart.ts", "function": "total", "line": 42, "in_app": true}]}'
```

The body is one error, as JSON (`Content-Type: application/json`; `gzip` and `deflate` work).
It needs a `type`, a `message`, or both. All other fields are optional:

| Field | Value |
|---|---|
| `event_id` | Your ID for the event. |
| `level` | `fatal`, `error`, `warning`, `info` or `debug`. |
| `timestamp` | An ISO time or Unix seconds. |
| `release`, `environment`, `server_name` | Text. |
| `platform` | Text. The default is `other`. |
| `tags` | `{"key": "value"}` |
| `user` | `{"id": ..., "email": ..., ...}` |
| `request` | `{"method": ..., "url": ..., "headers": {...}}` |
| `extra` | Any JSON object. |
| `fingerprint` | A list of up to 16 strings (see [grouping](what-checkend-stores.md#3-grouping-into-issues)). |
| `frames` | Up to 1000 stack frames (see below). |

Each frame can have `file`, `function`, `module`, `line`, `column`, `in_app` and `context`:
`{"pre": [...], "line": "...", "post": [...]}`, with up to 20 lines before and after. **List the
frame that raised the error first**, in the same order as most printed stack traces.

The responses are the same as for the Sentry endpoints: `200` with `{"id": "<event_id>"}`, `400`
when the body is not valid (no `type` or `message`, a field of the wrong type, or not JSON),
`401`, `413` and `429`. An unknown project and a wrong key give the same `401`.

An event from this endpoint goes through the same steps as a Sentry event: the size limits, the
rate limit, back-pressure, secret removal, the size limits on stored data, grouping, and the
counts. The endpoint has no CORS headers: in a browser, use a Sentry SDK.

## Next

- [What Checkend stores](what-checkend-stores.md): what happens to an event after it is accepted.
- [Settings and health](settings.md): limits that you can change.
