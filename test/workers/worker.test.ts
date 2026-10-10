import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { createProject } from "../../src/core/projects.ts";
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

describe("Worker API", () => {
	const get = (path: string, token?: string) =>
		exports.default.fetch(
			new Request(`https://checkend.test${path}`, {
				headers: token ? { authorization: `Bearer ${token}` } : {},
			}),
		);

	it("reads ADMIN_TOKEN from the Worker environment", async () => {
		expect((await get("/v1/issues")).status).toBe(401);
		expect((await get("/v1/issues", "wrong")).status).toBe(401);
		const response = await get("/v1/issues", env.ADMIN_TOKEN);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: expect.any(Array), next_cursor: null });
	});

	it("runs every issue filter on D1, and gives 404 for an unknown project", async () => {
		const project = await createProject(cloudflarePorts(env, createExecutionContext()), {
			name: "Filters",
		});
		const query = `project=${project.id}&status=unresolved&release=shop%401.0.0&environment=production&since=24h&search=100%25&limit=5`;
		const response = await get(`/v1/issues?${query}`, env.ADMIN_TOKEN);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({ data: [], next_cursor: null });
		const unknown = await get("/v1/issues?project=no-such-project", env.ADMIN_TOKEN);
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({ error: "project_not_found" });
	});
});
