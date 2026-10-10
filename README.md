# Checkend

Open-source error tracking for coding agents. It runs on your own Cloudflare account.

> **Status: in development.** Error ingest from Sentry SDKs and a JSON API work. The rest is not
> built yet. See the [guides](guides/README.md) for what works today. Watch this repo to follow the build.
>
> Looking for the previous Rails version of Checkend? It is on the
> [`rails-legacy`](https://github.com/Checkend/checkend/tree/rails-legacy) branch and the
> [`v-rails-final`](https://github.com/Checkend/checkend/releases/tag/v-rails-final) tag.

## Why

Most bugs are now fixed by coding agents, but error trackers are still dashboards for people.
Checkend gives agents what they need to fix an error, and then checks in production that the fix
worked.

**Every production error should end in a verified fix.**

## What it will do

- **Works with any Sentry SDK.** Change one DSN line. Every language works on day one.
- **Built for agents.** An MCP server, a CLI with JSON output, and an OpenAPI API. The web UI is a small view for humans.
- **Issue briefs.** Each issue gives an agent the in-app stack with source lines, the release that introduced it, the suspect commit, the frequency and similar past issues, in a short, structured form.
- **A verified fix loop.** An agent claims an issue and links its fix. Checkend watches the next deploy. The issue is verified when the error stops, and it reopens if the error comes back.
- **Your own infrastructure.** One-click deploy to your Cloudflare account (Workers, D1, Queues, R2). No servers. Your error data stays in your account.
- **An open spec.** The issue brief format and the fix-verification protocol will be published for any tool to use.

## Guides

- [Quick start](guides/quick-start.md): run Checkend, connect an app, and read its errors.
- [All guides](guides/README.md): sending errors, what Checkend stores, the API, settings, architecture.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Coding agents: read [AGENTS.md](AGENTS.md) first.
Security problems: see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Contributions use a DCO sign-off (`git commit -s`).

"Checkend" is a trademark of Furvur.
