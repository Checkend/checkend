import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import type { Config } from "../../src/ports/config.ts";
import { sql } from "../../src/ports/db.ts";
import { loadSentryFixtures } from "../fixtures/sentry/load.ts";
import { testPorts } from "../support/node-ports.ts";

const TOKEN = "test-admin-token-0123456789";

async function setup(config: Partial<Config> = { adminToken: TOKEN }) {
	const t = await testPorts({ config });
	const state = new IngestState();
	const app = createApp({ state });
	const call = async (
		method: string,
		path: string,
		body?: unknown,
		token: string | null = TOKEN,
	) => {
		const headers: Record<string, string> = {};
		if (token !== null) headers.authorization = `Bearer ${token}`;
		if (body !== undefined) headers["content-type"] = "application/json";
		const response = await app.request(
			`https://checkend.test${path}`,
			{ method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
			{ ports: t.ports },
		);
		const text = await response.text();
		return {
			status: response.status,
			headers: response.headers,
			body: text ? JSON.parse(text) : null,
		};
	};
	const ingest = async (projectId: number, key: string, fixtureName: string) => {
		const fixture = loadSentryFixtures().find((f) => f.name === fixtureName);
		if (!fixture) throw new Error(fixtureName);
		await app.request(
			`https://checkend.test/api/${projectId}/envelope/?sentry_key=${key}`,
			{ method: "POST", headers: fixture.headers, body: fixture.body },
			{ ports: t.ports },
		);
		await t.settle();
	};
	return { ...t, app, call, ingest };
}

describe("admin token", () => {
	it.each([
		["no token", null],
		["a wrong token", "nope"],
		["a token that differs at the end", `${TOKEN.slice(0, -1)}X`],
	])("rejects %s with 401", async (_label, token) => {
		const { call } = await setup();
		const response = await call("GET", "/v1/issues", undefined, token);
		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
		expect(response.body).toEqual({ error: "unauthorized" });
	});

	it("rejects every request when no admin token is configured", async () => {
		const { call } = await setup({});
		expect((await call("GET", "/v1/issues", undefined, "")).status).toBe(401);
		expect((await call("GET", "/v1/issues", undefined, "anything")).status).toBe(401);
	});
});

describe("projects API", () => {
	it("creates a project and returns its DSN", async () => {
		const { call } = await setup();
		const response = await call("POST", "/v1/projects", { name: "Shop", platform: "javascript" });
		expect(response.status).toBe(201);
		expect(String(response.body.data.id)).toMatch(/^[1-9]\d{9}$/);
		expect(response.body.data).toMatchObject({
			name: "Shop",
			slug: "shop",
			platform: "javascript",
		});
		expect(response.body.data.dsn).toBe(
			`https://${new URL(response.body.data.dsn).username}@checkend.test/${response.body.data.id}`,
		);
	});

	it("rejects an invalid body with 400", async () => {
		const { call } = await setup();
		const response = await call("POST", "/v1/projects", { name: 42 });
		expect(response.status).toBe(400);
		expect(response.body.error).toBe("invalid_request");
	});

	it("lists projects with their DSNs", async () => {
		const { call } = await setup();
		await call("POST", "/v1/projects", { name: "A" });
		await call("POST", "/v1/projects", { name: "B" });
		const response = await call("GET", "/v1/projects");
		expect(response.body.data.map((p: { slug: string }) => p.slug)).toEqual(["a", "b"]);
		expect(response.body.data[0].dsns[0]).toMatch(
			/^https:\/\/[0-9a-f]{32}@checkend\.test\/[1-9]\d{9}$/,
		);
	});
});

describe("issues API", () => {
	async function withIssues() {
		const s = await setup();
		const created = (await s.call("POST", "/v1/projects", { name: "Shop" })).body.data;
		const key = new URL(created.dsn).username;
		await s.ingest(created.id, key, "node-type-error");
		s.clock.advance(1000);
		await s.ingest(created.id, key, "node-message");
		s.clock.advance(1000);
		await s.ingest(created.id, key, "browser-unhandled-error");
		return { ...s, project: created };
	}

	it("lists issues, newest last_seen first, with counts and the ingest state", async () => {
		const { call, project } = await withIssues();
		const response = await call("GET", "/v1/issues");
		expect(response.status).toBe(200);
		expect(response.body.data.map((i: { title: string }) => i.title)).toEqual([
			"Error: Checkout button handler failed for order 5521",
			"Cache miss rate above 90% for key user:1234",
			"TypeError: Cannot read properties of undefined (reading 'name')",
		]);
		expect(response.body.data[0]).toMatchObject({
			id: expect.any(Number),
			project_id: project.id,
			status: "unresolved",
			level: "error",
			times_seen: 1,
			fingerprint_version: 1,
			first_seen: "2026-10-10T12:00:02.000Z",
		});
		expect(response.body.next_cursor).toBeNull();
		expect(response.body.ingest).toMatchObject({ mode: "full", write_failures_today: 0 });
	});

	it("pages with limit and cursor", async () => {
		const { call } = await withIssues();
		const first = await call("GET", "/v1/issues?limit=2");
		expect(first.body.data).toHaveLength(2);
		const second = await call("GET", `/v1/issues?limit=2&cursor=${first.body.next_cursor}`);
		expect(second.body.data).toHaveLength(1);
		expect(second.body.next_cursor).toBeNull();
		const ids = [...first.body.data, ...second.body.data].map((i: { id: number }) => i.id);
		expect(new Set(ids).size).toBe(3);
	});

	it("filters by project and status, and rejects invalid filters", async () => {
		const { call, project } = await withIssues();
		expect((await call("GET", "/v1/issues?project=1234567890")).status).toBe(404);
		expect(
			(await call("GET", `/v1/issues?project=${project.id}&status=unresolved`)).body.data,
		).toHaveLength(3);
		expect((await call("GET", "/v1/issues?status=resolved")).body.data).toEqual([]);
		for (const query of [
			"limit=0",
			"limit=101",
			"status=nope",
			"project=Bad_Slug!",
			"cursor=%%%",
		]) {
			expect((await call("GET", `/v1/issues?${query}`)).status, query).toBe(400);
		}
	});

	it("returns one issue with its latest event", async () => {
		const { call } = await withIssues();
		const [issue] = (await call("GET", "/v1/issues")).body.data;
		const response = await call("GET", `/v1/issues/${issue.id}`);
		expect(response.status).toBe(200);
		expect(response.body.data).toMatchObject({ id: issue.id, title: issue.title });
		expect(response.body.data.latest_event_id).toEqual(expect.any(Number));
		expect((await call("GET", "/v1/issues/999")).status).toBe(404);
		expect((await call("GET", "/v1/issues/abc")).status).toBe(400);
	});

	it("lists the stored events of an issue", async () => {
		const { call } = await withIssues();
		const [issue] = (await call("GET", "/v1/issues")).body.data;
		const response = await call("GET", `/v1/issues/${issue.id}/events`);
		expect(response.body.data).toHaveLength(1);
		expect(response.body.data[0]).toMatchObject({
			issue_id: issue.id,
			event_id: expect.stringMatching(/^[0-9a-f]{32}$/),
		});
	});

	it("returns one event with the normalized data and never the raw payload", async () => {
		const { call, ports } = await withIssues();
		const row = await ports.db.first<{ id: number }>(
			sql`SELECT id FROM events ORDER BY id LIMIT 1`,
		);
		const response = await call("GET", `/v1/events/${row?.id}`);
		expect(response.status).toBe(200);
		expect(response.body.data.event.exceptions[0].type).toBe("TypeError");
		expect(response.body.data).not.toHaveProperty("raw");
		expect(JSON.stringify(response.body)).not.toContain('"raw"');
		expect((await call("GET", "/v1/events/999")).status).toBe(404);
	});
});
