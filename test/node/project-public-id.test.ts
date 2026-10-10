import { makeDsn } from "@sentry/core";
import { describe, expect, it } from "vitest";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { newPublicProjectId } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { loadSentryFixtures } from "../fixtures/sentry/load.ts";
import { testPorts } from "../support/node-ports.ts";

const TOKEN = "public-id-test-admin-token-0123";

async function setup() {
	const t = await testPorts({ config: { adminToken: TOKEN } });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : null, text };
	};
	return { ...t, app, call };
}

describe("public project IDs", () => {
	it("migration 0004 gives existing projects a random 10-digit public ID", async () => {
		const db = openSqliteDb(":memory:");
		const all = readMigrations("migrations");
		await applyMigrations(
			db,
			all.filter((m) => m.name < "0004"),
		);
		await db.run(
			sql`INSERT INTO projects (name, slug, created_at) VALUES (${"Old"}, ${"old"}, ${"2026-10-10T00:00:00Z"})`,
		);
		await applyMigrations(db, all);
		const row = await db.first<{ id: number; public_id: number }>(
			sql`SELECT id, public_id FROM projects`,
		);
		expect(String(row?.public_id)).toMatch(/^[1-9]\d{9}$/);
		await expect(
			db.run(
				sql`INSERT INTO projects (name, slug, created_at, public_id) VALUES (${"New"}, ${"new"}, ${"x"}, ${row?.public_id ?? 0})`,
			),
		).rejects.toThrow(/UNIQUE/);
	});

	it("generates random 10-digit IDs that are not in order", () => {
		const ids = Array.from({ length: 1000 }, newPublicProjectId);
		for (const id of ids) {
			expect(Number.isSafeInteger(id)).toBe(true);
			expect(String(id)).toMatch(/^[1-9]\d{9}$/);
		}
		const rising = ids.slice(1).filter((id, i) => id > (ids[i] as number)).length;
		expect(rising).toBeGreaterThan(400);
		expect(rising).toBeLessThan(600);
		expect(new Set(ids).size).toBe(1000);
	});

	it("gives each project a public ID that is not its row ID, and a DSN that Sentry SDKs accept", async () => {
		const { call, ports } = await setup();
		const created = (await call("POST", "/v1/projects", { name: "Shop" })).body.data;
		expect(String(created.id)).toMatch(/^[1-9]\d{9}$/);
		const row = await ports.db.first<{ id: number; public_id: number }>(
			sql`SELECT id, public_id FROM projects`,
		);
		expect(created.id).toBe(row?.public_id);
		expect(created.id).not.toBe(row?.id);
		const dsn = makeDsn(created.dsn);
		expect(dsn?.projectId).toBe(String(created.id));
		expect(dsn?.publicKey).toMatch(/^[0-9a-f]{32}$/);
	});

	it("never returns the internal row ID: projects, issues and events use the public ID", async () => {
		const { call, app, ports, settle } = await setup();
		const project = (await call("POST", "/v1/projects", { name: "Shop" })).body.data;
		const internal = (await ports.db.first<{ id: number }>(sql`SELECT id FROM projects`))?.id;
		const key = new URL(project.dsn).username;
		const fixture = loadSentryFixtures().find((f) => f.name === "node-type-error");
		if (!fixture) throw new Error("fixture");
		await app.request(
			`https://checkend.test/api/${project.id}/envelope/?sentry_key=${key}`,
			{ method: "POST", headers: fixture.headers, body: fixture.body },
			{ ports },
		);
		await settle();
		const projects = (await call("GET", "/v1/projects")).body.data;
		expect(projects.map((p: { id: number }) => p.id)).toEqual([project.id]);
		const issues = await call("GET", "/v1/issues");
		expect(issues.body.data[0].project_id).toBe(project.id);
		const issue = await call("GET", `/v1/issues/${issues.body.data[0].id}`);
		expect(issue.body.data.project_id).toBe(project.id);
		const events = await call("GET", `/v1/issues/${issues.body.data[0].id}/events`);
		expect(events.body.data[0].project_id).toBe(project.id);
		const event = await call("GET", `/v1/events/${events.body.data[0].id}`);
		expect(event.body.data.project_id).toBe(project.id);
		for (const response of [issues, issue, events, event]) {
			expect(response.text).not.toMatch(new RegExp(`"project_id":${internal}[,}]`));
		}
	});

	it("filters issues by public ID or slug, and rejects the internal ID", async () => {
		const { call, app, ports, settle } = await setup();
		const project = (await call("POST", "/v1/projects", { name: "Shop" })).body.data;
		const key = new URL(project.dsn).username;
		const fixture = loadSentryFixtures().find((f) => f.name === "node-message");
		if (!fixture) throw new Error("fixture");
		await app.request(
			`https://checkend.test/api/${project.id}/envelope/?sentry_key=${key}`,
			{ method: "POST", headers: fixture.headers, body: fixture.body },
			{ ports },
		);
		await settle();
		expect((await call("GET", `/v1/issues?project=${project.id}`)).body.data).toHaveLength(1);
		expect((await call("GET", "/v1/issues?project=shop")).body.data).toHaveLength(1);
		expect((await call("GET", "/v1/issues?project=1")).body.data).toHaveLength(0);
		expect((await call("GET", "/v1/issues?project=unknown-slug")).body.data).toHaveLength(0);
	});

	it("gives the same 401 for an unknown project ID and a wrong key (no enumeration)", async () => {
		const { call, app, ports } = await setup();
		const project = (await call("POST", "/v1/projects", { name: "Shop" })).body.data;
		const key = new URL(project.dsn).username;
		const send = (projectId: string | number, k: string) =>
			app.request(
				`https://checkend.test/api/${projectId}/envelope/?sentry_key=${k}`,
				{ method: "POST", body: '{}\n{"type":"event"}\n{"message":"x"}\n' },
				{ ports },
			);
		const unknownProject = await send(1, key); // the internal row ID
		const wrongKey = await send(project.id, "0".repeat(32));
		expect(unknownProject.status).toBe(401);
		expect(wrongKey.status).toBe(401);
		expect(await unknownProject.text()).toBe(await wrongKey.text());
		expect((await send(project.id, key)).status).toBe(200);
	});
});
