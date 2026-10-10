import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { readMigrations } from "./src/adapters/node/migrations-fs.ts";

export default defineConfig(async () => ({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				// Test-only bindings: the migration files, read here because workerd has no file system.
				bindings: {
					TEST_MIGRATIONS: readMigrations("migrations"),
					TEST_D1_MIGRATIONS: await readD1Migrations("migrations"),
				},
			},
		}),
	],
	test: {
		name: "workers",
		include: ["test/workers/**/*.test.ts"],
	},
}));
