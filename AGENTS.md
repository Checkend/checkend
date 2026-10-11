# AGENTS.md

Instructions for coding agents (and humans) who work on Checkend. Read this file before you change code.

Checkend is open-source error tracking for coding agents. It runs as one Cloudflare Worker with D1.
The core is portable, so the same code can also run on Node with SQLite.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install the dependencies. |
| `npm test` | Run all tests: the `node` project and the `workers` project (`workerd`). |
| `npm run test:perf` | The CPU budget test. It runs alone, so that the times are stable. |
| `npx vitest run --project node` | Run only the Node tests (fast: core, SQLite, tools). |
| `npm run lint` | Biome: format and lint checks. `npm run lint:fix` fixes what it can. |
| `npm run typecheck` | TypeScript for the Workers runtime and for Node. |
| `npm run types` | Generate `worker-configuration.d.ts` again after you change `wrangler.jsonc`. It ignores `.dev.vars`, so local secrets do not change the types. |
| `npm run dev` | Run the Worker locally, in development mode (`CHECKEND_DEV=1`). First run `npx wrangler d1 migrations apply DB --local`. |
| `npm run demo` | Local only: create a "Demo" project and send about 500 realistic events over 14 days through ingest. Needs `npm run dev` and `ADMIN_TOKEN` in `.dev.vars`. Refuses any URL that is not localhost. |
| `npm run migrations:build` | Write `src/entry/migrations.generated.ts` (the migrations of the hosted install) again after you add a migration. A test fails when it is out of date. |
| `npm run check` | Lint, typecheck, tests and the CPU budget. Run it before each commit. |
| `npm run project -- create --name <name>` | Create a project and print its DSN (needs `CHECKEND_URL` and `CHECKEND_ADMIN_TOKEN`). `list` prints all projects. |
| `npm run deploy:production` | People only (see rule 9). Deploys with `wrangler.production.jsonc`: a copy of `wrangler.jsonc` with your Worker name and `database_id`. Files named `wrangler.*.jsonc` are git-ignored and blocked by the pre-commit hook. Both deploy scripts (`scripts/deploy.ts`) record a D1 Time Travel bookmark (`scripts/d1-bookmark.ts`; no bookmark: no migrations), apply the migrations, deploy, then run `setup-link` while setup is open. |
| `npm run setup-link -- --url <url> [--config <file>]` | People only. While the web UI has no member: store a new random `SETUP_CODE` secret (through stdin) and print the one-time setup link `https://<host>/setup#<code>`. |

Requirements: Node 22.18 or later (built-in SQLite and TypeScript type stripping).

## Layout (ports and adapters)

```
src/
  core/                 Domain logic. Web Standard APIs only. Uses ports, never bindings.
  ports/                Interfaces: Db, Clock, and the Ports object.
  http/                 Hono routes. Web Standard APIs only.
  adapters/cloudflare/  Cloudflare implementations of the ports (D1, ...).
  adapters/node/        Node implementations of the ports (SQLite, ...).
  entry/worker.ts       The Worker entry. Builds the ports from `env` and serves the app.
  entry/durable-object.ts  The hosted install: one Durable Object = one install (its own SQLite).
migrations/             Plain SQL migrations for D1 and SQLite.
test/contract/          Tests that every adapter of a port must pass.
test/node/              Node tests (core, SQLite adapter, tools).
test/workers/           workerd tests (D1 adapter, Worker entry).
scripts/                Repository tools (DCO check).
```

## Portable rules

Checkend runs on Cloudflare first, and it must also run off Cloudflare. These rules keep that possible.

1. **No `cloudflare:*` imports** outside `src/adapters/cloudflare/` and the Cloudflare entries
   (`src/entry/worker.ts`, `src/entry/durable-object.ts`).
   Biome enforces this rule.
2. **Web Standard APIs only** in `core/`, `ports/` and `http/`. No `node:*` imports there (Biome
   enforces this), and no bindings. Code that needs the runtime goes behind a port.
3. **No interactive transactions.** For atomic writes, use one `Db.batch()`. All statements of a
   batch apply, or none do.
4. **Bound parameters only.** Build SQL with the `sql` tag: `` sql`SELECT * FROM t WHERE id = ${id}` ``.
   Never put a value into SQL text. Biome plugins in `lint/` reject a template with values or a
   concatenation in `{ sql: ... }`, `.prepare()` and `.exec()`. A statement has at most 100 parameters and at most 100 KB of SQL
   (D1 limits). The adapters reject statements above these limits.
5. **SQL must be valid on D1 and on SQLite.** The `Db` contract tests run on both.
6. **Consumers are idempotent.** Queue and background work can run more than once (at-least-once).
7. **Single-tenant.** One install serves one organization. Tables have no `org_id` or `tenant_id`.
8. **A new port needs contract tests** in `test/contract/`, run against each adapter.
9. **Checkend never reports its own errors to itself** (a failure could loop). Its errors go to
   Workers Logs (`console.error` with JSON). The product code has no Sentry SDK; the SDKs in
   `devDependencies` only record test fixtures. A test checks both.

## How we build

1. **Test first (TDD).** Write a failing test. Run it and see it fail. Write the smallest code that
   passes. Refactor. Each change to behaviour starts with a test.
2. **Thin vertical slices.** Each increment goes from ingest to storage to read to action, and is
   used on real apps before the next one starts. The maintainers use each increment on their own
   apps first.
3. **Keep raw data.** Store each sampled event payload unchanged, so that later versions can
   process old data again.
4. **Version what can change.** `fingerprint_version` on issues, `/v1` for the API, `brief_version`
   in the issue brief. A change to the grouping must not split issues without a migration.
5. **Migrations are forward-only and additive.** Expand first; remove old columns only in a later
   release. Never edit a migration that is released. Every deploy runs the migrations.
6. **API and MCP changes are additive** inside `/v1`. Add fields and tools; do not rename or remove them.
7. **Unfinished features stay behind flags** (environment variables), off by default, so that
   `main` can always be deployed.
8. **Build a port when the first feature needs it.** The second adapter comes when its runtime ships.
9. **Agents do not deploy.** Do not deploy, push to `main`, or change production resources.
   A maintainer does that.
10. **Tag each increment** as `v0.N`, with short release notes.

## Ingest and API

- **Ingest:** `POST /api/<project>/envelope/` and `/api/<project>/store/`, the Sentry protocol.
  Any Sentry SDK works with a Checkend DSN. Only error events are kept; other items are dropped.
- **API:** `/v1/projects`, `/v1/issues`, `/v1/issues/:id`, `/v1/issues/:id/events`,
  `/v1/events/:id`. Each request needs `Authorization: Bearer <ADMIN_TOKEN>`. The API never
  returns the raw payload.
- **Web UI:** server-rendered HTML in `src/http/ui/` (no SPA, no build step). Passkey sign-in;
  `/setup` registers the first member with the one-time setup link (the `SETUP_CODE` secret in
  the URL fragment; the client sends it in the body), then closes. ADMIN_TOKEN is not accepted. Cookie sessions
  (`__Host-`, HttpOnly, Secure, SameSite=Strict) and a CSRF token on every form; the UI never
  uses bearer tokens. Write HTML only with the `h` tag in `src/http/ui/html.ts` (it escapes);
  no `raw()` and no `innerHTML` (a test checks). Put event data in `untrusted()` blocks and
  through `displayText()`. Strict CSP: no inline script or style. Format issue, event and
  project IDs in URLs only with `src/http/ui/ids.ts`; never show the internal project row ID.
- **Development mode** (`CHECKEND_DEV=1`, only from `npm run dev`; never in `wrangler.jsonc`):
  `/dev/login` signs in without a passkey, `/setup` needs no code, and ingest accepts
  `X-Checkend-Demo-Time`. All three work only for requests to localhost. Tests check that they
  are off otherwise.
- **Untrusted input:** every ingest check lives in `src/core/ingest/`, so each entry point gets
  it. Order: project, DSN key, rate limit, D1 state, body caps (1 MB sent, 2 MB decompressed,
  1 MB per event), JSON depth, schema and limits, scrubbing. Add a hostile case to
  `test/node/ingest/hostile.test.ts` for each new input path.
- **Grouping:** `src/core/ingest/fingerprint.ts` (version 1). A change splits issues: it needs
  a new version. The fixture snapshot test fails on any change.
- **CPU budget:** the Workers Free plan allows 10 ms of CPU per request. `npm run test:perf`
  measures the worst events.
- **Golden fixtures:** `test/fixtures/sentry/` holds real SDK requests. Record new ones with
  `node test/fixtures/sentry/capture-node.ts` (and `capture-browser.ts` with a browser).

Settings (Workers secrets and vars; all optional):

| Name | Default | Purpose |
|---|---|---|
| `ADMIN_TOKEN` (secret) | none | Bearer token for `/v1`. Without it, the API rejects all requests. |
| `SETUP_CODE` (secret) | none | The one-time code of the setup link, as `<unix seconds>.<code>`: the link expires after 24 hours (deploy logs show it). `npm run setup-link` sets it; do not set it by hand. |
| `D1_DAILY_ROW_LIMIT` | none | Set `100000` on the Workers Free plan: from 80% of it, ingest stores counters only until 00:00 UTC. |
| `EVENTS_PER_ISSUE` | 100 | Stored events per issue. |
| `NEW_ISSUES_PER_HOUR` | 100 | New issues per project per hour; more go to one "flood" issue. |
| `TAG_KEYS_PER_PROJECT` | 200 | Distinct tag keys per project. |
| `INGEST_RATE_LIMITER` (binding) | 1000/min per DSN key | Optional Rate Limiting binding. Without it, there is no rate limit. |
| `PUBLIC_URL` | none | The public origin, for example `https://errors.example.com`. Set: the passkey relying party, the CSRF origin check, the recipes, `llms.txt` and the DSNs use it, never the request `Host`. Set it on Node behind a proxy. |

For local development, put `ADMIN_TOKEN=...` in `.dev.vars` (git-ignored).

## Migrations

- Add a file `migrations/NNNN_description.sql` (four digits, then a name). Use
  `npx wrangler d1 migrations create DB description` to make one.
- On Cloudflare, `wrangler d1 migrations apply` runs them (the `deploy` script does this).
  On Node and in tests, `applyMigrations()` runs the same files. A hosted install (a Durable Object)
  runs them on its first start after a deploy, from `src/entry/migrations.generated.ts`: after you
  add a migration, run `npm run migrations:build`. Both record them in the
  `d1_migrations` table.
- Each migration runs as one atomic batch. Do not use `CREATE TRIGGER` (the statement splitter
  does not support it), and do not use `BEGIN`/`COMMIT`.

## Tests

- Node project (`test/node/`): core logic, the SQLite adapter, tools. Fast.
- Workers project (`test/workers/`): runs in `workerd` with a local D1. Use it for the D1 adapter
  and the Worker entry.
- Contract tests (`test/contract/`) run in both projects: the same tests for D1 and SQLite.

## Commits and pull requests

- Small commits. Each commit passes `npm run check`.
- Sign off every commit (Developer Certificate of Origin): `git commit -s`. CI checks it.
- Run `git config core.hooksPath .githooks` once per clone. The pre-commit hook blocks private
  planning files that some maintainers keep in the working tree, and it scans staged changes for
  secrets with gitleaks (rules in `.gitleaks.toml`; install gitleaks first). Fake secrets in tests
  must contain `test` or `example`. CI scans the full history.
- Security problems: see [SECURITY.md](SECURITY.md). Do not open a public issue.
