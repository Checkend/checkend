import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "rollups-admin-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const store = async (type: string, extra: Record<string, unknown> = {}) => {
		const raw = { exception: { values: [{ type, value: `${type} failed` }] }, ...extra };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
		return (
			await t.ports.db.first<{ id: number }>(
				sql`SELECT id FROM issues WHERE fingerprint = ${prepared.fingerprint.hash}`,
			)
		)?.id as number;
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
	return { ...t, store, call, project };
}

describe("hourly roll-ups and users affected", () => {
	it("counts events per hour, and shows events in the last 24 hours and 7 days", async () => {
		const { store, call, clock, ports } = await setup();
		const id = await store("AlphaError");
		await store("AlphaError");
		clock.advance(3600_000);
		await store("AlphaError");
		const hours = await ports.db.all(
			sql`SELECT hour, count FROM issue_counts WHERE issue_id = ${id} ORDER BY hour`,
		);
		expect(hours).toEqual([
			{ hour: "2026-10-10T12", count: 2 },
			{ hour: "2026-10-10T13", count: 1 },
		]);
		expect((await call("GET", `/v1/issues/${id}`)).body.data).toMatchObject({
			events_24h: 3,
			events_7d: 3,
		});
		clock.advance(24 * 3600_000);
		expect((await call("GET", `/v1/issues/${id}`)).body.data).toMatchObject({
			events_24h: 0,
			events_7d: 3,
		});
	});

	it("counts distinct users, not events; an event without a user adds no user", async () => {
		const { store, call } = await setup();
		const id = await store("AlphaError", { user: { id: "u1" } });
		await store("AlphaError", { user: { id: "u1" } });
		await store("AlphaError", { user: { id: "u2", email: "b@example.com" } });
		await store("AlphaError", { user: { email: "c@example.com" } });
		await store("AlphaError");
		expect((await call("GET", `/v1/issues/${id}`)).body.data.users_affected).toBe(3);
	});

	it("does not count an SDK resend of the same event twice", async () => {
		const { store, call } = await setup();
		const event = { event_id: "b".repeat(32), user: { id: "u1" } };
		const id = await store("AlphaError", event);
		await store("AlphaError", event);
		expect((await call("GET", `/v1/issues/${id}`)).body.data).toMatchObject({
			events_24h: 1,
			users_affected: 1,
		});
	});

	it("moves counts and users to the target of a merge", async () => {
		const { store, call } = await setup();
		const target = await store("AlphaError", { user: { id: "u1" } });
		const source = await store("BetaError", { user: { id: "u2" } });
		await store("BetaError", { user: { id: "u1" } });
		await call("POST", `/v1/issues/${target}/merge`, { source_ids: [source] });
		expect((await call("GET", `/v1/issues/${target}`)).body.data).toMatchObject({
			events_24h: 3,
			users_affected: 2,
		});
	});

	it("shows the counts and users affected in the brief", async () => {
		const { store, ports } = await setup();
		const id = await store("AlphaError", { user: { id: "u1" } });
		const brief = await buildBrief(ports.db, id, ports.clock.now());
		expect(brief?.json.issue).toMatchObject({ events_24h: 1, events_7d: 1, users_affected: 1 });
		expect(brief?.markdown).toContain("| Events (24 h / 7 d) | 1 / 1 |");
		expect(brief?.markdown).toContain("| Users affected | 1 |");
	});
});

describe("priority score v1", () => {
	it("ranks by users, recent events, recency and newness; sort=priority uses it", async () => {
		const { store, call, clock } = await setup();
		// Old: first seen 3 days ago, one user, no event in the last 24 hours.
		const old = await store("OldError", { user: { id: "u0" } });
		clock.advance(3 * 86_400_000);
		// Busy: many users and events now.
		const busy = await store("BusyError", { user: { id: "u1" } });
		for (const u of ["u2", "u3", "u4"]) await store("BusyError", { user: { id: u } });
		// Quiet: new now, one event, no user.
		const quiet = await store("QuietError");
		const list = (await call("GET", "/v1/issues?sort=priority")).body.data;
		expect(list.map((i: { id: number }) => i.id)).toEqual([busy, quiet, old]);
		expect(list[0].priority).toBeGreaterThan(list[1].priority);
		expect(list[2].priority).toBeGreaterThan(0);
		const byTime = (await call("GET", "/v1/issues")).body.data.map((i: { id: number }) => i.id);
		expect(byTime).toEqual([quiet, busy, old]);
	});

	it("pages through the priority order with a cursor", async () => {
		const { store, call } = await setup();
		for (const type of ["A", "B", "C"]) await store(`${type}Error`);
		const first = (await call("GET", "/v1/issues?sort=priority&limit=2")).body;
		expect(first.data).toHaveLength(2);
		const second = (
			await call("GET", `/v1/issues?sort=priority&limit=2&cursor=${first.next_cursor}`)
		).body;
		expect(second.data).toHaveLength(1);
		expect(new Set([...first.data, ...second.data].map((i: { id: number }) => i.id)).size).toBe(3);
	});
});
