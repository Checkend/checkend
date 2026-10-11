import type { D1Migration } from "cloudflare:test";
import type { Migration } from "../../src/core/migrations.ts";

declare global {
	namespace Cloudflare {
		interface Env {
			ADMIN_TOKEN: string;
			BLOBS: R2Bucket;
			INGEST_RATE_LIMITER: RateLimit;
			INGEST_QUEUE: Queue<object>;
			TEST_MIGRATIONS: Migration[];
			INSTALL: DurableObjectNamespace<import("../../src/entry/durable-object.ts").CheckendInstall>;
			TEST_SQL: DurableObjectNamespace;
			TEST_SOURCEMAP: string;
			TEST_D1_MIGRATIONS: D1Migration[];
			TEST_SENTRY_FIXTURES: {
				name: string;
				path: string;
				headers: Record<string, string>;
				bodyBase64: string;
			}[];
		}
	}
}
