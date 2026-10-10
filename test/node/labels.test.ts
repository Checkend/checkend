import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "labels-admin-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const store = async (message: string) => {
		const raw = new TextEncoder().encode(JSON.stringify({ message }));
		const prepared = await prepareEvent(raw, t.clock.now());
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
		return (
			await t.ports.db.first<{ id: number }>(
				sql`SELECT id FROM issues WHERE fingerprint = ${prepared.fingerprint.hash}`,
			)
		)?.id as number;
	};
	const call = async (method: string, path: string, token: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const agent = (
		await createToken(t.ports, BOOTSTRAP_ADMIN, {
			name: "agent",
			scopes: ["issues:read", "issues:write"],
		})
	).token;
	return { ...t, store, call, agent };
}

describe("triage labels (GET /v1/labels)", () => {
	it("derives labels from the activity, and marks the corrections", async () => {
		const { store, call, agent } = await setup();
		const a = await store("Card declined");
		await call("POST", `/v1/issues/${a}/resolve`, agent);
		await store("Card declined"); // a regression: the resolve was wrong
		await call("POST", `/v1/issues/${a}/ignore`, agent);
		await call("POST", `/v1/issues/${a}/unresolve`, ADMIN); // a person reverses the ignore
		await call("POST", `/v1/issues/${a}/notes`, agent, { text: "not a label" });
		const labels = (await call("GET", "/v1/labels", ADMIN)).body.data;
		expect(
			labels.map((l: Record<string, unknown>) => [
				l.issue_id,
				l.label,
				l.actor_type,
				l.actor_name,
				l.corrects,
			]),
		).toEqual([
			[a, "unresolved", "admin_token", "ADMIN_TOKEN", "ignored"],
			[a, "ignored", "token", "agent", null],
			[a, "regressed", "system", "ingest", "resolved"],
			[a, "resolved", "token", "agent", null],
		]);
	});

	it("labels merges and splits; a split corrects the grouping", async () => {
		const { store, call, agent, ports } = await setup();
		const a = await store("Alpha");
		const b = await store("Beta");
		await call("POST", `/v1/issues/${a}/merge`, agent, { source_ids: [b] });
		const event = (
			await ports.db.first<{ id: number }>(
				sql`SELECT id FROM events WHERE issue_id = ${a} ORDER BY id DESC`,
			)
		)?.id;
		await call("POST", `/v1/issues/${a}/split`, agent, { event_ids: [event] });
		const labels = (await call("GET", "/v1/labels", ADMIN)).body.data;
		expect(labels.map((l: Record<string, unknown>) => [l.label, l.corrects])).toEqual([
			["split", "grouping"],
			["merged", null],
		]);
		expect(labels[1].data).toEqual({ source_ids: [b] });
	});

	it("needs the admin scope, and filters by since", async () => {
		const { store, call, agent, clock } = await setup();
		const a = await store("Alpha");
		await call("POST", `/v1/issues/${a}/resolve`, agent);
		expect((await call("GET", "/v1/labels", agent)).status).toBe(403);
		clock.advance(2 * 3600_000);
		await call("POST", `/v1/issues/${a}/unresolve`, agent);
		expect(
			(await call("GET", "/v1/labels?since=1h", ADMIN)).body.data.map(
				(l: { label: string }) => l.label,
			),
		).toEqual(["unresolved"]);
	});
});
