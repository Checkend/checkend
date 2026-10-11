# Architecture

Checkend is one Cloudflare Worker, written in TypeScript with [Hono](https://hono.dev), and one
D1 database. The core does not depend on Cloudflare, so the same code also runs on Node with
SQLite (see [Run without Cloudflare](self-host.md)).

This guide gives an overview. The full rules for contributors are in
[AGENTS.md](../AGENTS.md).

## Ports and adapters

The code has three layers:

- **Core** (`src/core/`) and **HTTP routes** (`src/http/`) contain the logic. They use Web
  Standard APIs only.
- **Ports** (`src/ports/`) are interfaces: the database, the clock, background work, the rate
  limit, the settings, DNS, outgoing requests, blob storage, the queues, email, and the client
  address.
- **Adapters** implement the ports for one runtime: `src/adapters/cloudflare/` (D1, the SQLite of
  a Durable Object, R2, Queues, Email Service) and `src/adapters/node/` (SQLite with the built-in `node:sqlite`, a jobs table,
  a folder or S3, SMTP).

Three entries build the ports and serve the same app, with the same migrations:

- the Worker entry (`src/entry/worker.ts`) on Cloudflare
- the Node entry (`src/entry/server.ts`) on Node and in Docker
- an entry for hosted tenants (`src/entry/durable-object.ts`): one Durable Object per install,
  with its own SQLite database

The linter (Biome) enforces the layers. Only the Cloudflare adapter and the Cloudflare entries
(the Worker and the Durable Object) can import `cloudflare:*`. Core, ports and HTTP routes cannot import `node:*`.

## The database port

The database port is small, so that D1 and SQLite (`node:sqlite`, or the SQLite of a Durable
Object) can all implement it:

- It is async, and it uses SQL.
- Atomic writes use `batch()`: all statements apply, or none do. There are no interactive
  transactions.
- Values go in as bound parameters only, with the `sql` tag. A lint rule rejects values in SQL
  text.
- A statement has at most 100 parameters and 100 KB of SQL (the D1 limits).

The same contract tests run on the D1 adapter, the Durable Object adapter and the SQLite
adapter.

## Migrations

Migrations are plain SQL files in `migrations/`, in the Wrangler format (`0001_name.sql`).

- On Cloudflare, `wrangler d1 migrations apply` runs them.
- On Node and in tests, `applyMigrations()` runs the same files.
- A Durable Object install runs them on its first start after a deploy, from
  `src/entry/migrations.generated.ts`. After you add a migration, run `npm run migrations:build`
  to write that file again. A test fails when it is out of date.

All three record the applied migrations in the same `d1_migrations` table. `/health` shows the
migration level.

## Tests and CI

The tests use Vitest, in three projects:

| Project | Runs |
|---|---|
| `node` | Core logic, the SQLite adapter and tools, on Node. |
| `workers` | The D1 adapter, the Durable Object adapter and the Cloudflare entries, in `workerd` with a local D1. |
| `perf` | The CPU budget test, alone, so that the times are stable. |

The Workers Free plan allows 10 ms of CPU time per request. Times from the CPU budget test (Node
on Apple silicon, the test running alone; production is not measured yet):

| Event | CPU time |
|---|---|
| A typical event | 0.8 ms |
| The worst real-SDK event (710 KB) | 5.9 ms |
| The largest accepted event (1 MB) | 7.6 ms |

On a GitHub Actions runner, the worst real-SDK event took 9–12.5 ms, near the 10 ms Free plan
limit. Production CPU is not measured yet.

The CPU budget test does not check absolute times. It compares each event with a fixed
calibration task on the same machine, so the result is stable on slower CI runners.

CI on GitHub Actions runs the lint, a check of the generated Worker types, the type check, the
tests, the CPU budget test, a bundle build, and a DCO sign-off check. Two more jobs check Checkend
without Cloudflare: the Node tests and a start of the Node server, and a build of the Docker
image that starts it, makes a backup and stops it with `SIGTERM`. Run the lint, the type check,
the tests and the CPU budget test locally with `npm run check`.
