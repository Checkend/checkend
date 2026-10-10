# Quick start

This guide shows how to run Checkend, connect an app with a Sentry SDK, and read the errors.

You need:

- Node 22.18 or later
- a clone of the [Checkend repository](https://github.com/Checkend/checkend), with `npm ci` done
- for a deploy: a Cloudflare account and `npx wrangler login`

## 1. Run Checkend on your computer

1. Create the local database tables:

   ```sh
   npx wrangler d1 migrations apply DB --local
   ```

2. Make an admin token, and put it in `.dev.vars` (this file is git-ignored):

   ```sh
   echo "ADMIN_TOKEN=$(openssl rand -hex 32)" > .dev.vars
   ```

3. Start the Worker:

   ```sh
   npm run dev
   ```

4. Check that it runs:

   ```sh
   curl http://localhost:8787/health
   ```

   The response has `"status": "ok"`. See [Settings and health](settings.md#health) for the
   other fields.

## 2. Or deploy it to your Cloudflare account

> **Caution:** a deploy uses resources in your Cloudflare account. On the Workers Free plan, also
> set `D1_DAILY_ROW_LIMIT` (see [Budget mode](settings.md#budget-mode-workers-free-plan)).

1. Create a D1 database. Wrangler prints its `database_id`.

   ```sh
   npx wrangler d1 create checkend
   ```

2. Copy `wrangler.jsonc` to `wrangler.<name>.jsonc`, for example `wrangler.mine.jsonc`. In the
   copy, set your Worker `name`, and add the `database_id` to the `DB` entry. Files with the name
   `wrangler.*.jsonc` are git-ignored, so your resource IDs stay out of the repository.

3. Apply the migrations and deploy:

   ```sh
   npx wrangler d1 migrations apply DB --remote --config wrangler.mine.jsonc
   npx wrangler deploy --config wrangler.mine.jsonc
   ```

4. Set the admin token as a Worker secret. Until the secret is set, the API answers `401`.

   ```sh
   npx wrangler secret put ADMIN_TOKEN --config wrangler.mine.jsonc
   ```

For a project with many users, also add a rate limiting rule in front of ingest: see
[Protect the ingest path](sending-errors.md#protect-the-ingest-path).

Apply the migrations before each deploy. Wrangler records each applied migration and skips it,
so it is safe to run the command again.

## 3. Create a project and get a DSN

A project is one app. Each project has a DSN: the address that the Sentry SDK sends errors to.

```sh
export CHECKEND_URL=https://<your-worker>      # or http://localhost:8787
export CHECKEND_ADMIN_TOKEN=<your ADMIN_TOKEN>

npm run project -- create --name "My App" --platform node
```

The command prints the project ID and the DSN. To see all projects and their DSNs later:

```sh
npm run project -- list
```

Add `--json` to either command for JSON output.

## 4. Connect your app

Use any Sentry SDK. Put the Checkend DSN in `Sentry.init`. For example, in Node:

```js
import * as Sentry from "@sentry/node";

Sentry.init({ dsn: "https://<key>@<your-worker>/<project-id>" });
```

Browser SDKs work too: the ingest endpoints allow requests from other origins (CORS).

Checkend keeps **error events only** (exceptions and `captureMessage`). It drops sessions,
transactions, client reports and attachments. See [Send errors](sending-errors.md).

## 5. Read the errors

```sh
curl -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" "$CHECKEND_URL/v1/issues"
```

Each issue is a group of events with the same cause. To see one issue and its events:

```sh
curl -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" "$CHECKEND_URL/v1/issues/1"
curl -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" "$CHECKEND_URL/v1/issues/1/events"
```

See [API](api.md) for all endpoints.

## 6. Give your coding agent a read-only token

Do not give the admin token to an agent. Create a token that can only read issues:

```sh
curl -X POST "$CHECKEND_URL/v1/tokens" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "claude-code", "scopes": ["issues:read"]}'
```

The response has the token (`ck_...`). Copy it now: Checkend shows it only once. Give it to the
agent as its bearer token. To revoke it later, use `DELETE /v1/tokens/:id`.

If the agent must also resolve, ignore or merge issues, create its token with
`"scopes": ["issues:read", "issues:write"]`.

## 7. Connect your coding agent with MCP

Add the Checkend MCP server to your agent with the read-only token. For Claude Code:

```sh
claude mcp add --transport http checkend "$CHECKEND_URL/mcp" \
  --header "Authorization: Bearer <token>"
```

Then ask the agent, for example: "Fix the top unresolved error in Checkend." The agent calls
`list_issues`, then `get_issue_brief`. See [MCP server](mcp.md) for the tools and the issue
brief.

To let Checkend check in production that the fixes work, report your deploys. See
[Verify fixes](fix-loop.md).
