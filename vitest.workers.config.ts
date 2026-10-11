import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { readMigrations } from "./src/adapters/node/migrations-fs.ts";
import { loadSentryFixtures } from "./test/fixtures/sentry/load.ts";

export default defineConfig(async () => ({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			// The self-host Worker plus the test-only Durable Object classes (not in wrangler.jsonc).
			main: "./test/workers/test-entry.ts",
			miniflare: {
				// The hosted install (one object = one install) and an empty object for the Db contract.
				durableObjects: {
					INSTALL: { className: "CheckendInstall", useSQLite: true },
					TEST_SQL: { className: "TestSqlObject", useSQLite: true },
				},
				// The optional R2 bucket (BlobStore). Not in wrangler.jsonc: an install without it works.
				r2Buckets: ["BLOBS"],
				// The optional per-key rate limit (not in wrangler.jsonc: see the docs).
				ratelimits: {
					INGEST_RATE_LIMITER: { namespace_id: "1001", simple: { limit: 1000, period: 60 } },
				},
				// The optional ingest overflow queue (producer and consumer on the test Worker).
				queueProducers: { INGEST_QUEUE: "checkend-ingest-test" },
				queueConsumers: ["checkend-ingest-test"],
				// Test-only bindings: the migration files, read here because workerd has no file system.
				bindings: {
					ADMIN_TOKEN: "workers-test-admin-token-0123456789",
					// "<unix seconds>.<code>", made now: the setup link is valid for 24 hours.
					SETUP_CODE: `${Math.floor(Date.now() / 1000)}.workers-test-setup-code-0123456789abcdef`,
					TEST_SETUP_CODE: "workers-test-setup-code-0123456789abcdef",
					TEST_MIGRATIONS: readMigrations("migrations"),
					TEST_SOURCEMAP: readFileSync("test/fixtures/sourcemaps/app.min.js.map", "utf8"),
					TEST_D1_MIGRATIONS: await readD1Migrations("migrations"),
					TEST_SENTRY_FIXTURES: loadSentryFixtures().map((f) => ({
						name: f.name,
						path: f.path,
						headers: f.headers,
						bodyBase64: Buffer.from(f.body).toString("base64"),
					})),
				},
			},
		}),
	],
	test: {
		name: "workers",
		include: ["test/workers/**/*.test.ts"],
	},
}));
