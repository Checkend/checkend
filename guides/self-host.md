# Run without Cloudflare

Checkend can also run as one Node process with one SQLite file, for example in Docker. It has the
same features and the same API as on Cloudflare.

## With Docker

```sh
docker run -p 8787:8787 -v checkend-data:/data -e ADMIN_TOKEN=<at least 32 characters> \
  ghcr.io/checkend/checkend:<version>
```

> **Note:** the maintainers publish the image for release tags (`linux/amd64` and `linux/arm64`).
> Until the first release, build it yourself from the repository: `docker build -t checkend .`,
> and use the image `checkend`.

Or use Docker Compose with
[`examples/docker/compose.yaml`](../examples/docker/compose.yaml). Put the secrets in a `.env` file
next to it, never in the image:

```sh
ADMIN_TOKEN=<output of: openssl rand -hex 32>
ENCRYPTION_KEYS=k1:<output of: openssl rand -base64 32>
```

Then run `docker compose up -d`.

The image:

- runs as a user that is not root
- keeps all its data on the `/data` volume (the SQLite file and the blobs)
- has a health check (`/health`)
- runs the migrations at start

## Without Docker

You need Node 22.18 or later:

```sh
npm ci --omit=dev
ADMIN_TOKEN=$(openssl rand -hex 32) node src/entry/server.ts
```

## Settings

Checkend reads the same environment variables as the Worker (`ADMIN_TOKEN`, `ENCRYPTION_KEYS`,
`RETENTION_DAYS`, `GITHUB_TOKEN`, ...; see [Settings and health](settings.md)). These are only for
Node:

| Name | Default | What it does |
|---|---|---|
| `DATABASE_PATH` | `data/checkend.sqlite` (in the image: `/data/checkend.sqlite`) | The SQLite file. |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | Where the server listens. |
| `BLOBS_DIR` | none (in the image: `/data/blobs`) | A folder for blobs: source maps and large raw payloads. |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | none | S3-compatible storage for blobs (also R2), instead of `BLOBS_DIR`. |
| `SMTP_URL`, `EMAIL_FROM` | none | Email alerts: `smtps://user:password@host:465`. `smtp://` is only for a local relay without a user and password: with credentials, it must be `smtps://`, else the server does not start and names the reason. |
| `TRUSTED_PROXIES` | none | The proxies whose `X-Forwarded-For` Checkend reads: addresses, CIDR ranges, `loopback` or `private`, separated by commas. |
| `RATE_LIMIT_PER_MINUTE` | 1000 | The rate limit for each DSN key. `0` turns it off. |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` | none | Workers AI for [AI triage and similar issues](ai-triage.md), through the REST API and AI Gateway. The token needs **Workers AI Read**. Without them, there is no AI. On Node, the vectors of similar issues stay in SQLite. |

## Behind a reverse proxy

> **Caution:** Checkend serves plain HTTP on port 8787, so tokens and DSN keys would travel in
> clear text. Put a TLS reverse proxy in front of it (for example Caddy, nginx or Traefik), and
> publish only the proxy.

- Set [`PUBLIC_URL`](settings.md#public_url) to the public address, for example
  `https://errors.example.com`. Without it, the proxy must forward the real `Host` header: the
  passkeys, the CSRF check of the web UI, the recipes, `llms.txt` and the DSNs use the host of the
  request. A wrong `Host` makes passkeys work only on that host, and makes the CSRF check trust
  that host.
- Set `TRUSTED_PROXIES` to the proxy (for example `private`). Without it, every client looks like
  the proxy, so all clients share one rate limit. All browsers also share one sign-in limit of the
  [web UI](web-ui.md#2-sign-in) (20 tries in 15 minutes), so one client can stop sign-in for
  everyone.

Checkend reads `X-Forwarded-For` from the right, and only through trusted proxies, so a client
cannot fake its address.

## Web UI

On Node and Docker, the setup link is not available yet. Until then, use development mode only
on a local machine, or deploy on Cloudflare. See [Web UI](web-ui.md).

## What is different from Cloudflare

| | Cloudflare | Node |
|---|---|---|
| Database | D1 | One SQLite file |
| Queue (overflow, webhook deliveries) | Cloudflare Queues (optional) | A table in the same SQLite file, with retries; failed jobs are kept |
| Schedule | A Cron Trigger every 5 minutes | A timer in the process, every 5 minutes |
| Blobs | R2 (`BLOBS`) | A folder (`BLOBS_DIR`) or S3-compatible storage |
| Email | Email Service (`EMAIL`) | SMTP (`SMTP_URL`) |

On Node, a webhook connects only to the address that passed the [URL check](webhooks.md#url-rules),
so a DNS change after the check cannot send it to an internal address.

The safety check of [scrub patterns](what-checkend-stores.md#your-own-scrub-rules) measures CPU
time on Node, so a busy server does not reject a fast pattern.

When Checkend gets `SIGTERM` (for example from `docker stop`), it stops taking requests, writes
the events that it already accepted, closes the database, and exits. So after a clean stop, the
file `checkend.sqlite` alone is complete: the recent writes are no longer in a separate `-wal`
file.

## Backups and upgrades

See [Backup and upgrade](operations.md).
