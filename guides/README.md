# Checkend guides

Checkend is open-source error tracking for coding agents. It runs as one Cloudflare Worker with a
D1 database, in your own Cloudflare account.

> **Status: early development.** Checkend can receive errors from Sentry SDKs, group them into
> issues, and return them through a JSON API. It has no web UI, no alerts and no MCP server yet.
> Expect changes.

## Guides

| Guide | Read it when you want to |
|---|---|
| [Quick start](quick-start.md) | Run Checkend, connect an app, and read its errors. |
| [Send errors](sending-errors.md) | Know what the ingest endpoints accept, and what they return. |
| [What Checkend stores](what-checkend-stores.md) | Know how events are cleaned, limited and grouped into issues. |
| [API](api.md) | Read projects, issues and events with HTTP and JSON. |
| [Settings and health](settings.md) | Change limits, use the Workers Free plan, and check `/health`. |
| [Architecture](architecture.md) | Understand how the code is built, and how it can run off Cloudflare. |

Contributors and coding agents: read [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md) first.

## What works today

- **Error ingest** with the Sentry protocol. Any Sentry SDK works: change the DSN.
- **Secret removal** before anything is stored.
- **Grouping** of events into issues. A deploy that only moves code does not create new issues:
  line numbers and bundle hashes are not used.
- **Protection** for your Cloudflare account: size limits, rate limits, caps per project, and a
  budget mode for the Workers Free plan.
- **A JSON API** (`/v1`) with one admin token.
- **A project CLI** (`npm run project`) to create projects and print their DSNs.

## Not built yet

These features are planned. They are **not** available now:

- the MCP server and issue briefs
- scoped API tokens (now there is one admin token)
- a web UI
- alerts
- source maps
- queue mode for ingest
- a Node or Docker entry (the core can run on Node, but there is no Node server yet)
- API calls that change an issue (for example, resolve)
