import type { D1Migration } from "cloudflare:test";
import type { Migration } from "../../src/core/migrations.ts";

declare global {
	namespace Cloudflare {
		interface Env {
			ADMIN_TOKEN: string;
			BLOBS: R2Bucket;
			TEST_MIGRATIONS: Migration[];
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
