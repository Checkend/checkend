import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The root wrangler.jsonc is the deploy-button config: a new Workers Free account must deploy it
 * with no extra steps. Optional bindings (R2, Queues, Email, Rate Limiting) are added by hand
 * (see the docs); the Worker detects them at runtime. CI also runs wrangler deploy --dry-run.
 */
const text = readFileSync("wrangler.jsonc", "utf8");
// JSONC: remove // comments (not inside strings: the file has no "//" in its values).
const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, any>;

describe("the root wrangler.jsonc (deploy button)", () => {
	it("has D1 without a database_id, so that the deploy provisions it", () => {
		expect(config.d1_databases).toEqual([
			{ binding: "DB", database_name: "checkend", migrations_dir: "migrations" },
		]);
	});

	it("has exactly one cron (fix verification, retries, retention)", () => {
		expect(config.triggers).toEqual({ crons: ["*/5 * * * *"] });
	});

	it("has no optional bindings: R2, Queues, Email, Rate Limiting", () => {
		for (const key of [
			"r2_buckets",
			"queues",
			"send_email",
			"ratelimits",
			"kv_namespaces",
			"durable_objects",
		]) {
			expect(config[key], key).toBeUndefined();
		}
		expect(text).not.toMatch(/database_id|account_id/);
	});
});
