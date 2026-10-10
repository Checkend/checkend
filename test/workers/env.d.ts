import type { D1Migration } from "cloudflare:test";
import type { Migration } from "../../src/core/migrations.ts";

declare global {
	namespace Cloudflare {
		interface Env {
			TEST_MIGRATIONS: Migration[];
			TEST_D1_MIGRATIONS: D1Migration[];
		}
	}
}
