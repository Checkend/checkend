import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "quota-admin-token-0123456789";

async function setup(config: { dailyEventLimit?: number | null } = {}) {
	const t = await testPorts({ config: { adminToken: ADMIN, ...config } });
	const shop = await createProject(t.ports, { name: "Shop" });
	const other = await createProject(t.ports, { name: "Other" });
	const app = createApp({ state: new IngestState() });
	const send = async (project: typeof shop, message = `error ${Math.random()}`) => {
		const response = await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message }),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return response;
	};
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	return { ...t, shop, other, send, call };
}

describe("per-project daily quotas", () => {
	it("accepts events up to the quota, then 429 until midnight UTC; other projects are not affected", async () => {
		const { send, call, shop, other, clock } = await setup();
		const set = await call("PATCH", `/v1/projects/${shop.slug}`, { daily_quota: 3 });
		expect(set.body.data).toMatchObject({ daily_quota: 3 });
		for (let i = 0; i < 3; i++) expect((await send(shop)).status).toBe(200);
		const over = await send(shop);
		expect(over.status).toBe(429);
		// The clock is 2026-10-10T12:00:00Z: 12 hours to midnight.
		expect(over.headers.get("retry-after")).toBe(String(12 * 3600));
		expect(over.headers.get("x-sentry-rate-limits")).toBe(
			`${12 * 3600}::organization:quota_exceeded`,
		);
		expect((await send(other)).status).toBe(200);
		const projects = (await call("GET", "/v1/projects")).body.data;
		expect(projects.find((p: { slug: string }) => p.slug === shop.slug)).toMatchObject({
			daily_quota: 3,
			events_today: 3,
		});
		clock.advance(12 * 3600_000 + 61_000);
		expect((await send(shop)).status).toBe(200);
	});

	it("counts the events that D1 already has (another isolate), and removes the quota with null", async () => {
		const { send, call, shop, ports } = await setup();
		for (let i = 0; i < 2; i++) await send(shop);
		await call("PATCH", `/v1/projects/${shop.slug}`, { daily_quota: 2 });
		// A new app: an isolate that has not seen the events.
		const fresh = createApp({ state: new IngestState() });
		const response = await fresh.request(
			`https://checkend.test/api/${shop.id}/store/?sentry_key=${shop.publicKey}`,
			{ method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"x"}' },
			{ ports },
		);
		expect(response.status).toBe(429);
		await call("PATCH", `/v1/projects/${shop.slug}`, { daily_quota: null });
		expect(
			(await call("GET", "/v1/projects")).body.data.find(
				(p: { slug: string }) => p.slug === shop.slug,
			).daily_quota,
		).toBeNull();
	});

	it("validates the quota", async () => {
		const { call, shop } = await setup();
		for (const daily_quota of [0, -1, 1.5, "10", 1_000_000_001]) {
			expect(
				(await call("PATCH", `/v1/projects/${shop.slug}`, { daily_quota })).status,
				String(daily_quota),
			).toBe(400);
		}
	});
});

describe("the daily event limit of the install (DAILY_EVENT_LIMIT)", () => {
	it("counts the events of all projects; above the limit, 429 for every project until midnight UTC", async () => {
		const { send, shop, other, clock } = await setup({ dailyEventLimit: 3 });
		expect((await send(shop)).status).toBe(200);
		expect((await send(other)).status).toBe(200);
		expect((await send(shop)).status).toBe(200);
		for (const project of [shop, other]) {
			const over = await send(project);
			expect(over.status).toBe(429);
			expect(over.headers.get("retry-after")).toBe(String(12 * 3600));
			expect(over.headers.get("x-sentry-rate-limits")).toBe(
				`${12 * 3600}::organization:quota_exceeded`,
			);
		}
		clock.advance(12 * 3600_000 + 61_000);
		expect((await send(shop)).status).toBe(200);
	});

	it("writes no row for a refused event (a flood above the limit costs no writes)", async () => {
		const { send, shop, ports } = await setup({ dailyEventLimit: 1 });
		await send(shop);
		// SQLite: all rows that this connection inserted, updated or deleted so far.
		const rows = async () =>
			(await ports.db.first<{ n: number }>(sql`SELECT total_changes() AS n`))?.n;
		const before = await rows();
		expect(before).toBeGreaterThan(0);
		for (let i = 0; i < 20; i++) expect((await send(shop, "same error")).status).toBe(429);
		expect(await rows()).toBe(before);
	});

	it("counts the events that the database already has (another isolate)", async () => {
		const { send, shop, ports } = await setup({ dailyEventLimit: 2 });
		await send(shop);
		await send(shop);
		const fresh = createApp({ state: new IngestState() });
		const response = await fresh.request(
			`https://checkend.test/api/${shop.id}/store/?sentry_key=${shop.publicKey}`,
			{ method: "POST", headers: { "content-type": "application/json" }, body: '{"message":"x"}' },
			{ ports },
		);
		expect(response.status).toBe(429);
	});

	it("does not use the install limit for events that the quota of a project refuses", async () => {
		const { send, call, shop, other } = await setup({ dailyEventLimit: 3 });
		await call("PATCH", `/v1/projects/${shop.slug}`, { daily_quota: 1 });
		expect((await send(shop)).status).toBe(200);
		for (let i = 0; i < 5; i++) expect((await send(shop)).status).toBe(429);
		expect((await send(other)).status).toBe(200);
		expect((await send(other)).status).toBe(200);
		expect((await send(other)).status).toBe(429);
	});

	it("has no limit by default (self-host)", async () => {
		const { send, shop } = await setup();
		for (let i = 0; i < 5; i++) expect((await send(shop)).status).toBe(200);
	});
});
