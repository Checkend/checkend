# Checkend guides

Checkend is open-source error tracking for coding agents. It runs as one Cloudflare Worker with a
D1 database, in your own Cloudflare account.

> **Status: early development.** Checkend can receive errors from Sentry SDKs, group them into
> issues, give them to coding agents through an MCP server and a JSON API, and send alerts. It
> has no web UI yet. Expect changes.

## Guides

| Guide | Read it when you want to |
|---|---|
| [Quick start](quick-start.md) | Run Checkend, connect an app, and read its errors. |
| [Set up with an agent](agent-setup.md) | Let a coding agent add Checkend to your apps, with a short-lived setup key. |
| [MCP server](mcp.md) | Connect a coding agent, and read issue briefs. |
| [Webhooks](webhooks.md) | Call your agent runner when an issue is new, regressed or verified, or [start an agent from GitHub Actions](webhooks.md#start-an-agent-from-github-actions). |
| [Alerts](alerts.md) | Tell people in Slack, Discord, a GitHub issue or email. |
| [AI triage and similar issues](ai-triage.md) | Optional model advice on each issue: cause, severity, noise, and similar issues. |
| [Verify fixes](fix-loop.md) | Link a fix, report deploys, and let Checkend verify the fix in production. |
| [Send errors](sending-errors.md) | Know what the ingest endpoints accept, and what they return. |
| [Source maps](source-maps.md) | Upload source maps, so that briefs show the original JavaScript. |
| [What Checkend stores](what-checkend-stores.md) | Know how events are cleaned, limited and grouped into issues. |
| [API](api.md) | Read projects, issues and events with HTTP and JSON. |
| [Settings and health](settings.md) | Change limits, use the Workers Free plan, and check `/health`. |
| [Run without Cloudflare](self-host.md) | Run Checkend in Docker or on Node, with one SQLite file. |
| [Backup and upgrade](operations.md) | Back up the database, and upgrade safely. |
| [Architecture](architecture.md) | Understand how the code is built, and how it can run off Cloudflare. |

Open specs: the [Agent Issue Brief](../spec/agent-issue-brief.md) and the
[fix verification protocol](../spec/fix-verification.md) are written so that other tools can use
them too (see [`spec/`](../spec/README.md)).

Contributors and coding agents: read [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md) first.

## What works today

- **Error ingest** with the Sentry protocol. Any Sentry SDK works: change the DSN. Without a
  Sentry SDK, send JSON to `POST /v1/ingest`.
- **Secret removal** before anything is stored.
- **Trust levels and allowed origins**: a project that gets browser events is low trust, because
  its DSN is public. A project can allow browser events only from its own websites.
- **Grouping** of events into issues. A deploy that only moves code does not create new issues:
  line numbers and bundle hashes are not used.
- **Protection** for your Cloudflare account: size limits, rate limits, caps per project, and a
  budget mode for the Workers Free plan.
- **An MCP server** for coding agents, with issue briefs that mark app data as untrusted.
- **Issue actions**: resolve, ignore, unresolve, merge and split, with optional approvals. A resolved
  issue that gets a new event becomes unresolved again.
- **The fix loop**: an agent links its fix, CI reports deploys, and Checkend verifies the fix
  when the error stops, or marks the issue regressed when the error comes back.
- **Alerts** in Slack, Discord, GitHub issues and email, also for spikes, with safe messages.
- **Your own scrub rules**: key names and patterns for each project.
- **Outgoing webhooks**: signed requests with the issue brief, with retries, for new,
  regressed and verified issues.
- **Unusual tags**: the brief shows tag values that are much more common in an issue than in
  the project, for example one browser.
- **Suspect commits**: the brief can name a commit of the first release that changed a file in
  the stack trace (a hint, not proof).
- **Source maps**: upload them in CI, and the brief shows the original file and lines of
  minified JavaScript.
- **Self-hosting without Cloudflare**: one Docker container (or Node process) with one SQLite
  file, with backups.
- **Agent setup**: a coding agent registers your apps, adds the SDK and connects itself, with a
  setup key that lasts 1 hour.
- **AI triage and similar issues** (optional, off by default): model advice on each issue, in the
  brief.
- **Project delete and DSN rotation**.
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
