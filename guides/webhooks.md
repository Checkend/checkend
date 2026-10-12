# Webhooks

Checkend can call your URL when something happens to an issue: a new issue, a regression, or a
verified fix. Each request is signed and has the [issue brief](mcp.md#the-issue-brief), so that
an agent runner can start work on the issue.

## Before you start

> **Caution:** webhooks need `ENCRYPTION_KEYS`. Checkend keeps each webhook signing secret
> encrypted, so it must have a key. See [Encryption keys](#encryption-keys).

All webhook endpoints need the `admin` scope.

## Create a webhook

```sh
curl -X POST "$CHECKEND_URL/v1/webhooks" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "agent-runner", "url": "https://runner.example/checkend",
       "events": ["issue.new", "issue.regressed"]}'
```

| Field | Value |
|---|---|
| `name` | 1 to 100 characters. |
| `url` | The URL that Checkend calls. See [URL rules](#url-rules). |
| `events` | One or more of `issue.new`, `issue.regressed` and `issue.verified`. |
| `min_trust` | `high` (the default) or `low`. See [Trust](#trust). |
| `project` | A public project ID or slug. The default is all projects. |
| `format` | `checkend` (the default: the body below) or `github_dispatch` (see [Start an agent from GitHub Actions](#start-an-agent-from-github-actions)). For Slack, Discord, GitHub issues and email, see [Alerts](alerts.md). |
| `github_token` | Only for `github_dispatch`, and required for it. Checkend stores it encrypted and never returns it. |

The response (`201`) has the webhook and its `secret` (`whsec_...`). **The secret is only in this
response.** Keep it: your receiver needs it to check the signature.

| Event | When |
|---|---|
| `issue.new` | The first event of a new issue. |
| `issue.regressed` | A regression: a resolved issue gets an event, or the error comes back after a fix (see [Verify fixes](fix-loop.md#regression)). |
| `issue.verified` | A fix is verified. |
| `issue.spike` | The events of an issue in the current clock hour go above `spike_threshold` (see [Alerts](alerts.md#events)). |

## The request

Checkend sends a `POST` with a JSON body and these headers:

| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `user-agent` | `Checkend-Webhook/<version>` |
| `x-checkend-event` | The event, for example `issue.new`. |
| `x-checkend-delivery` | The delivery ID. Use it to ignore a repeat. |
| `x-checkend-signature` | `t=<unix seconds>,v1=<hex>` |

The body:

```json
{
  "event": "issue.new",
  "delivery_id": 31,
  "webhook_id": 2,
  "created_at": "2026-10-10T15:47:03.412Z",
  "issue": {
    "id": 1, "project_id": 4821937065, "status": "unresolved", "level": "error",
    "trust": "high", "priority": 198.462, "times_seen": 42, "users_affected": 2,
    "first_seen": "...", "last_seen": "...", "fix": null,
    "title_untrusted": "TypeError: Cannot read properties of undefined (reading 'id')"
  },
  "brief": { "markdown": "...", "json": { "...": "..." } }
}
```

Checkend builds the brief when it sends the request. The [untrusted data](mcp.md#untrusted-data)
rules apply: the text from your app is marked UNTRUSTED.

## Check the signature

`v1` is HMAC-SHA256 of `<t>.<raw body>`, with the webhook secret as the key, in hex. Your
receiver must:

1. Compute the HMAC of the raw body, before it parses the JSON.
2. Compare it with `v1` in constant time.
3. Reject an old `t`, for example older than 5 minutes.

An example for Node or a Cloudflare Worker:

```js
async function verify(request, secret) {
  const header = request.headers.get("x-checkend-signature") ?? "";
  const { t, v1 } = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const body = await request.text();
  if (!t || !v1 || Math.abs(Date.now() / 1000 - Number(t)) > 300) return null;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const signature = Uint8Array.from(v1.match(/../g) ?? [], (hex) => parseInt(hex, 16));
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(`${t}.${body}`));
  return ok ? JSON.parse(body) : null;
}
```

## Retries

A `2xx` response means that the delivery is done. Any other response, a timeout (10 seconds), a
network error, or a blocked address is a failure. Checkend does not follow redirects: a `3xx` is
a failure.

After a failure, Checkend tries again, up to 8 attempts in total. It waits 1 minute, 5 minutes,
30 minutes, 2 hours, 6 hours, 12 hours, then 24 hours. After the 8th attempt, the delivery is
`failed`. A Cron Trigger sends the retries that are due, every 5 minutes.

Checkend starts a delivery right after the change. The cron is the fallback. An optional
Cloudflare Queue binding, `NOTIFY`, can also start deliveries. Without it, deliveries work.

## Trust

A webhook gets only the issues of projects with `high` [trust](sending-errors.md#trust-and-allowed-origins),
unless its `min_trust` is `low`. So automatic agent runs skip low-trust issues by default: the
text of those issues can come from anyone who has a public DSN. A project is low trust when, in the
last 30 days, it got an event from a browser, a mobile app or an unknown SDK, unless an admin set
its trust.

## URL rules

To protect your network, a webhook URL must:

- use `https`
- have no `user:password`
- point to a host that resolves (A and AAAA) only to public addresses

Checkend blocks private, loopback and link-local addresses (for example the cloud metadata
address `169.254.169.254`), the CGNAT range `100.64.0.0/10`, multicast, reserved and
documentation ranges, IPv6 unique-local and link-local addresses, the IPv4-mapped and NAT64
forms of these, and names such as `localhost`, `*.local`, `*.internal` and `*.home.arpa`.
Checkend checks the URL when you create the webhook, and again before each delivery.

## Test and inspect

- `POST /v1/webhooks/:id/test` sends a `ping` event (`issue` and `brief` are `null`).
- `GET /v1/webhooks/:id/deliveries` lists the deliveries, with their status and last error.

See [Webhooks in the API](api.md#webhooks).

## Start an agent from GitHub Actions

With the `github_dispatch` format, Checkend starts a GitHub Actions workflow in your repository.
The example workflow has two jobs. Job `agent` gives the issue brief to Claude Code and saves the
change as a patch. Job `pr` checks the patch and opens a **draft** pull request, which a person
reviews.

### 1. Add the workflow

Copy [`examples/github-actions/checkend-agent.yml`](../examples/github-actions/checkend-agent.yml)
to `.github/workflows/` in your repository. Its header comment has the setup. Add the secret
`ANTHROPIC_API_KEY`.

To link the pull request as the fix, also add the secret `CHECKEND_TOKEN` (a token with
`issues:write`) and the variable `CHECKEND_URL`. Then the [fix loop](fix-loop.md) continues: Checkend
verifies the fix after the deploy.

### 2. Create the webhook

Make a fine-grained GitHub token for this one repository, with the permission
**Contents: Read and write** (GitHub needs it to create a dispatch) and nothing more. Then:

```sh
curl -X POST "$CHECKEND_URL/v1/webhooks" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "github-agent", "format": "github_dispatch",
       "url": "https://api.github.com/repos/my-org/my-app/dispatches",
       "github_token": "github_pat_...",
       "events": ["issue.new", "issue.regressed"]}'
```

For `github_dispatch`, the URL must be `https://api.github.com/repos/<owner>/<repo>/dispatches`.

### What Checkend sends

A GitHub `repository_dispatch` request, with `authorization: Bearer <token>`,
`accept: application/vnd.github+json` and `x-github-api-version: 2022-11-28` (and the Checkend
headers). The body:

```json
{
  "event_type": "checkend.issue.new",
  "client_payload": {
    "event": "issue.new", "delivery_id": 31, "webhook_id": 3,
    "issue": { "...": "the same issue object as above" },
    "brief_markdown": "# Checkend issue 1 (brief v1) ..."
  }
}
```

`event_type` is `checkend.issue.new`, `checkend.issue.regressed`, `checkend.issue.verified` or
`checkend.ping`. GitHub answers `204`, which means delivered.

### Least privilege

Treat the agent as untrusted: the brief contains error text from your application, and that text
can try to steer the agent (prompt injection). So the example workflow keeps the agent away from
any write access:

- **Job `agent`** can only read the repository (`contents: read`). It has no GitHub token
  (`persist-credentials: false`) and one secret, `ANTHROPIC_API_KEY`. It runs Claude Code (a
  pinned version) and saves the change as a patch (an artifact). It never commits or pushes.
- **Job `pr`** has the write token (`contents: write` and `pull-requests: write`). It starts
  from a fresh checkout, so a change that the agent made to `.git/` (hooks, config) does not
  reach it. It refuses the patch when the patch changes `.github/`, `.git`, a symlink, a
  submodule, or a path outside the work tree. It commits and pushes with git hooks off, and it
  runs no code from the repository or from the patch: no npm, no tests. Then it opens the draft
  pull request, and, optionally, links it as the fix.
- The default permissions of the workflow are `{}`.
- Values from the payload go only through environment variables and standard input, never
  inside a shell command, so they cannot inject a script.
- The workflow runs only for issues with `high` trust.
- There is no auto-merge: the pull request is a draft, and a person reviews it.
- The actions are pinned to commit SHAs. Update the SHAs and the Claude Code version on
  purpose, not automatically.

> **Caution:** one risk remains. In job `agent`, code that the agent writes or runs (for example
> the tests) can read the model API key and use the network. Use a dedicated key with a spending
> limit, and add an egress allow-list to job `agent` (for example `step-security/harden-runner`,
> allowing `api.anthropic.com` and `registry.npmjs.org`).

> **Note:** GitHub does not start other workflows for a pull request that `GITHUB_TOKEN` opens.
> To run your CI on it, mark it ready for review, or close and reopen it.

To use another agent (for example Codex), replace the "Run the agent" step in job `agent`.

## Encryption keys

Checkend keeps the secrets that it must read again (now: the webhook signing secrets) encrypted
with AES-256-GCM. Each value names the ID of its key.

1. Make a key:

   ```sh
   openssl rand -base64 32
   ```

2. Set the Worker secret `ENCRYPTION_KEYS` to `<id>:<key>`, for example `k1:<the key>`:

   ```sh
   npx wrangler secret put ENCRYPTION_KEYS --config wrangler.<name>.jsonc
   ```

To rotate the key, put a new key first and keep the old key: `k2:<new key>,k1:<old key>`. The
cron encrypts the old values again with the new key. When no value uses the old key, remove it.
Checkend ignores an entry that is not valid, and it logs only the key ID.
