import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { sql } from "../../src/ports/db.ts";

beforeAll(() => applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS));

describe("Worker entry", () => {
	it("GET /health answers with the version and the D1 migration level", async () => {
		const response = await exports.default.fetch("https://checkend.test/health");
		expect(response.status).toBe(200);
		const latest = env.TEST_MIGRATIONS.at(-1)?.name;
		expect(await response.json()).toEqual({
			status: "ok",
			version: pkg.version,
			migrations: {
				level: Number(latest?.slice(0, 4)),
				latest,
				applied: env.TEST_MIGRATIONS.length,
			},
			ingest: { mode: "full", write_failures_today: 0, retry_after_seconds: 0 },
			time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
	});
});

describe("cloudflarePorts", () => {
	it("builds the Db port on the DB binding and a system clock", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		expect(await ports.db.first(sql`SELECT ${41} + ${1} AS answer`)).toEqual({ answer: 42 });
		expect(Math.abs(ports.clock.now().getTime() - Date.now())).toBeLessThan(5_000);
	});
});
