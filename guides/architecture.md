# Architecture

Checkend is one Cloudflare Worker, written in TypeScript with [Hono](https://hono.dev), and one
D1 database. The core does not depend on Cloudflare, so the same code can also run on Node with
SQLite.

This guide gives an overview. The full rules for contributors are in
[AGENTS.md](../AGENTS.md).

## Ports and adapters

The code has three layers:

- **Core** (`src/core/`) and **HTTP routes** (`src/http/`) contain the logic. They use Web
  Standard APIs only.
- **Ports** (`src/ports/`) are interfaces: the database, the clock, the rate limiter, the
  settings, and background work.
- **Adapters** implement the ports for one runtime: `src/adapters/cloudflare/` (D1) and
  `src/adapters/node/` (SQLite, with the built-in `node:sqlite`).

The Worker entry (`src/entry/worker.ts`) makes the Cloudflare ports and serves the app. There is
no Node entry yet: the Node adapter is used in tests now.

The linter (Biome) enforces the layers. Only the Cloudflare adapter and the Worker entry can
import `cloudflare:*`. Core, ports and HTTP routes cannot import `node:*`.

## The database port

The database port is small, so that D1 and SQLite can both implement it:

- It is async, and it uses SQL.
- Atomic writes use `batch()`: all statements apply, or none do. There are no interactive
  transactions.
- Values go in as bound parameters only, with the `sql` tag. A lint rule rejects values in SQL
  text.
- A statement has at most 100 parameters and 100 KB of SQL (the D1 limits).

The same contract tests run on the D1 adapter and on the SQLite adapter.

## Migrations

Migrations are plain SQL files in `migrations/`, in the Wrangler format (`0001_name.sql`).

- On Cloudflare, `wrangler d1 migrations apply` runs them.
- On Node and in tests, `applyMigrations()` runs the same files.

Both record the applied migrations in the same `d1_migrations` table. `/health` shows the
migration level.

## Tests and CI

The tests use Vitest, in three projects:

| Project | Runs |
|---|---|
| `node` | Core logic, the SQLite adapter and tools, on Node. |
| `workers` | The D1 adapter and the Worker entry, in `workerd` with a local D1. |
| `perf` | The CPU budget test, alone, so that the times are stable. |

The Workers Free plan allows 10 ms of CPU time per request. Times from the CPU budget test (Node
on Apple silicon, the test running alone; production is not measured yet):

| Event | CPU time |
|---|---|
| A typical event | 0.8 ms |
| The worst real-SDK event (710 KB) | 5.9 ms |
| The largest accepted event (1 MB) | 7.6 ms |

CI on GitHub Actions runs the lint, a check of the generated Worker types, the type check, the
tests, the CPU budget test, a bundle build, and a DCO sign-off check. Run the same checks locally
with `npm run check`.
