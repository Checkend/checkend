# AGENTS.md

Instructions for coding agents (and humans) who work on Checkend. Read this file before you change code.

Checkend is open-source error tracking for coding agents. It runs as one Cloudflare Worker with D1.
The core is portable, so the same code can also run on Node with SQLite.

## Commands

| Command | What it does |
|---|---|
| `npm ci` | Install the dependencies. |
| `npm test` | Run all tests: the `node` project and the `workers` project (`workerd`). |
| `npx vitest run --project node` | Run only the Node tests (fast: core, SQLite, tools). |
| `npm run lint` | Biome: format and lint checks. `npm run lint:fix` fixes what it can. |
| `npm run typecheck` | TypeScript for the Workers runtime and for Node. |
| `npm run types` | Generate `worker-configuration.d.ts` again after you change `wrangler.jsonc`. |
| `npm run dev` | Run the Worker locally. First run `npx wrangler d1 migrations apply DB --local`. |
| `npm run check` | Lint, typecheck and test. Run it before each commit. |
| `npm run deploy:production` | People only (see rule 9). Deploys with `wrangler.production.jsonc`: a copy of `wrangler.jsonc` with your Worker name and `database_id`. Files named `wrangler.*.jsonc` are git-ignored and blocked by the pre-commit hook. |

Requirements: Node 22.13 or later.

## Layout (ports and adapters)

```
src/
  core/                 Domain logic. Web Standard APIs only. Uses ports, never bindings.
  ports/                Interfaces: Db, Clock, and the Ports object.
  http/                 Hono routes. Web Standard APIs only.
  adapters/cloudflare/  Cloudflare implementations of the ports (D1, ...).
  adapters/node/        Node implementations of the ports (SQLite, ...).
  entry/worker.ts       The Worker entry. Builds the ports from `env` and serves the app.
migrations/             Plain SQL migrations for D1 and SQLite.
test/contract/          Tests that every adapter of a port must pass.
test/node/              Node tests (core, SQLite adapter, tools).
test/workers/           workerd tests (D1 adapter, Worker entry).
scripts/                Repository tools (DCO check).
```

## Portable rules

Checkend runs on Cloudflare first, and it must also run off Cloudflare. These rules keep that possible.

1. **No `cloudflare:*` imports** outside `src/adapters/cloudflare/` and `src/entry/worker.ts`.
   Biome enforces this rule.
2. **Web Standard APIs only** in `core/`, `ports/` and `http/`. No `node:*` imports there (Biome
   enforces this), and no bindings. Code that needs the runtime goes behind a port.
3. **No interactive transactions.** For atomic writes, use one `Db.batch()`. All statements of a
   batch apply, or none do.
4. **Bound parameters only.** Build SQL with the `sql` tag: `` sql`SELECT * FROM t WHERE id = ${id}` ``.
   Never put a value into SQL text. A statement has at most 100 parameters and at most 100 KB of SQL
   (D1 limits). The adapters reject statements above these limits.
5. **SQL must be valid on D1 and on SQLite.** The `Db` contract tests run on both.
6. **Consumers are idempotent.** Queue and background work can run more than once (at-least-once).
7. **Single-tenant.** One install serves one organization. Tables have no `org_id` or `tenant_id`.
8. **A new port needs contract tests** in `test/contract/`, run against each adapter.

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

## Migrations

- Add a file `migrations/NNNN_description.sql` (four digits, then a name). Use
  `npx wrangler d1 migrations create DB description` to make one.
- On Cloudflare, `wrangler d1 migrations apply` runs them (the `deploy` script does this).
  On Node and in tests, `applyMigrations()` runs the same files. Both record them in the
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
  planning files that some maintainers keep in the working tree.
- Security problems: see [SECURITY.md](SECURITY.md). Do not open a public issue.
