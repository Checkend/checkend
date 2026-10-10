import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "split-admin-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	/** One issue with events whose messages differ; the fingerprint is the same (SDK fingerprint). */
	const store = async (message: string) => {
		const raw = { message, fingerprint: ["checkout"] };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
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
	await store("Card declined");
	await store("Card declined");
	t.clock.advance(3600_000);
	await store("Address missing");
	const issueId = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))
		?.id as number;
	const events = await t.ports.db.all<{ id: number; message: string }>(
		sql`SELECT id, json_extract(data, '$.message') AS message FROM events ORDER BY id`,
	);
	return { ...t, call, store, issueId, events };
}

describe("split_issue", () => {
	it("moves the chosen events to a new issue, with their counts", async () => {
		const { call, issueId, events } = await setup();
		const address = events.filter((e) => e.message === "Address missing").map((e) => e.id);
		const split = await call("POST", `/v1/issues/${issueId}/split`, { event_ids: address });
		expect(split.status).toBe(201);
		const created = split.body.data;
		expect(created).toMatchObject({
			title: "Address missing",
			times_seen: 1,
			stored_events: 1,
			events_7d: 1,
			status: "unresolved",
		});
		expect(created.id).not.toBe(issueId);
		const original = (await call("GET", `/v1/issues/${issueId}`)).body.data;
		expect(original).toMatchObject({ times_seen: 2, stored_events: 2, events_7d: 2 });
		const moved = (await call("GET", `/v1/issues/${created.id}/events`)).body.data.map(
			(e: { id: number }) => e.id,
		);
		expect(moved).toEqual(address);
	});

	it("records the split on both issues", async () => {
		const { call, issueId, events } = await setup();
		const created = (
			await call("POST", `/v1/issues/${issueId}/split`, { event_ids: [events[2]?.id] })
		).body.data;
		expect((await call("GET", `/v1/issues/${issueId}/activity`)).body.data[0]).toMatchObject({
			action: "issue.split",
			data: { new_issue_id: created.id, event_ids: [events[2]?.id] },
		});
		expect((await call("GET", `/v1/issues/${created.id}/activity`)).body.data[0]).toMatchObject({
			action: "issue.split_from",
			data: { issue_id: issueId },
		});
	});

	it("keeps new events with the old fingerprint on the original issue", async () => {
		const { call, issueId, events, store } = await setup();
		const created = (
			await call("POST", `/v1/issues/${issueId}/split`, { event_ids: [events[2]?.id] })
		).body.data;
		await store("Address missing");
		expect((await call("GET", `/v1/issues/${issueId}`)).body.data.times_seen).toBe(3);
		expect((await call("GET", `/v1/issues/${created.id}`)).body.data.times_seen).toBe(1);
	});

	it("rejects events of another issue, unknown events, and an empty list", async () => {
		const { call, issueId, ports } = await setup();
		const raw = new TextEncoder().encode(JSON.stringify({ message: "Other" }));
		const project = await ports.db.first<{ id: number }>(sql`SELECT id FROM projects`);
		await storeEvent(
			ports,
			new IngestState(),
			project?.id ?? 0,
			await prepareEvent(raw, ports.clock.now()),
		);
		const other = (
			await ports.db.first<{ id: number }>(sql`SELECT id FROM events ORDER BY id DESC`)
		)?.id;
		expect((await call("POST", `/v1/issues/${issueId}/split`, { event_ids: [other] })).status).toBe(
			400,
		);
		expect((await call("POST", `/v1/issues/${issueId}/split`, { event_ids: [99999] })).status).toBe(
			400,
		);
		expect((await call("POST", `/v1/issues/${issueId}/split`, { event_ids: [] })).status).toBe(400);
		expect((await call("POST", "/v1/issues/99999/split", { event_ids: [1] })).status).toBe(404);
	});
});
