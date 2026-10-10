# Checkend guides

Checkend is open-source error tracking for coding agents. It runs as one Cloudflare Worker with a
D1 database, in your own Cloudflare account.

> **Status: early development.** Checkend can receive errors from Sentry SDKs, group them into
> issues, and give them to coding agents through an MCP server and a JSON API. It has no web UI
> and no alerts yet. Expect changes.

## Guides

| Guide | Read it when you want to |
|---|---|
| [Quick start](quick-start.md) | Run Checkend, connect an app, and read its errors. |
| [MCP server](mcp.md) | Connect a coding agent, and read issue briefs. |
| [Send errors](sending-errors.md) | Know what the ingest endpoints accept, and what they return. |
| [What Checkend stores](what-checkend-stores.md) | Know how events are cleaned, limited and grouped into issues. |
| [API](api.md) | Read projects, issues and events with HTTP and JSON. |
| [Settings and health](settings.md) | Change limits, use the Workers Free plan, and check `/health`. |
| [Architecture](architecture.md) | Understand how the code is built, and how it can run off Cloudflare. |

Contributors and coding agents: read [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md) first.

## What works today

- **Error ingest** with the Sentry protocol. Any Sentry SDK works: change the DSN. Without a
  Sentry SDK, send JSON to `POST /v1/ingest`.
- **Secret removal** before anything is stored.
- **Grouping** of events into issues. A deploy that only moves code does not create new issues:
  line numbers and bundle hashes are not used.
- **Protection** for your Cloudflare account: size limits, rate limits, caps per project, and a
  budget mode for the Workers Free plan.
- **An MCP server** for coding agents, with issue briefs that mark app data as untrusted.
- **Issue actions**: resolve, ignore, unresolve, merge and split, with optional approvals. A resolved
  issue that gets a new event becomes unresolved again.
- **Priority**: each issue has a priority score from the users affected, the events in the last
  24 hours, and how recent and how new the issue is. MCP lists the top priority first.
- **Triage history**: each decision on an issue (resolve, ignore, merge, split, ...) and each
  correction of it, for example a resolved issue that comes back.
- **Claims and notes**: an agent claims an issue, so that other agents do not work on it, and
  writes notes to the timeline of the issue.
- **A JSON API** (`/v1`) with scoped tokens, and an audit timeline of token and project changes.
- **A project CLI** (`npm run project`) to create projects and print their DSNs.

## Not built yet

These features are planned. They are **not** available now:

- a web UI
- alerts
- source maps
- queue mode for ingest
- a Node or Docker entry (the core can run on Node, but there is no Node server yet)
