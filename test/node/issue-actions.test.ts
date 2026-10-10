import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import type { Config } from "../../src/ports/config.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "issue-actions-admin-token-0123";

async function setup(config: Partial<Config> = {}) {
	const t = await testPorts({ config: { adminToken: ADMIN, ...config } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const store = async (type: string) => {
		const raw = { exception: { values: [{ type, value: `${type} failed` }] } };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
		const row = await t.ports.db.first<{ id: number }>(
			sql`SELECT id FROM issues WHERE fingerprint = ${prepared.fingerprint.hash} OR title = ${`${type}: ${type} failed`} ORDER BY id DESC`,
		);
		return row?.id ?? 0;
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
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : null };
	};
	const token = async (name: string, scopes: string[]) =>
		(await createToken(t.ports, BOOTSTRAP_ADMIN, { name, scopes })).token;
	const writer = await token("agent-a", ["issues:read", "issues:write"]);
	const issue = async (id: number) => (await call("GET", `/v1/issues/${id}`, ADMIN)).body.data;
	return { ...t, project, store, call, token, writer, issue };
}

describe("resolve, ignore, unresolve", () => {
	it("changes the status, and records who did it", async () => {
		const { store, call, writer, issue } = await setup();
		const id = await store("AlphaError");
		expect((await call("POST", `/v1/issues/${id}/resolve`, writer)).body.data).toMatchObject({
			id,
			status: "resolved",
		});
		expect((await issue(id)).status).toBe("resolved");
		expect((await call("POST", `/v1/issues/${id}/ignore`, writer)).body.data.status).toBe(
			"ignored",
		);
		expect((await call("POST", `/v1/issues/${id}/unresolve`, writer)).body.data.status).toBe(
			"unresolved",
		);
		const activity = (await call("GET", "/v1/activity", ADMIN)).body.data;
		expect(
			activity
				.slice(0, 3)
				.map((a: Record<string, unknown>) => [a.action, a.actor_name, a.target_id]),
		).toEqual([
			["issue.unresolve", "agent-a", id],
			["issue.ignore", "agent-a", id],
			["issue.resolve", "agent-a", id],
		]);
		expect(activity[0].data).toEqual({ from: "ignored", to: "unresolved" });
	});

	it("needs issues:write; 404 for an unknown issue", async () => {
		const { store, call, token } = await setup();
		const id = await store("AlphaError");
		const reader = await token("reader", ["issues:read"]);
		expect(await call("POST", `/v1/issues/${id}/resolve`, reader)).toMatchObject({
			status: 403,
			body: { error: "forbidden", required_scope: "issues:write" },
		});
		expect((await call("POST", "/v1/issues/999/resolve", ADMIN)).status).toBe(404);
	});

	it("sets a resolved issue back to unresolved when a new event arrives (regression)", async () => {
		const { store, call, writer, issue } = await setup();
		const id = await store("AlphaError");
		await call("POST", `/v1/issues/${id}/resolve`, writer);
		await store("AlphaError");
		expect((await issue(id)).status).toBe("unresolved");
		const activity = (await call("GET", "/v1/activity", ADMIN)).body.data;
		expect(activity[0]).toMatchObject({
			action: "issue.regress",
			actor_type: "system",
			actor_name: "ingest",
			target_id: id,
		});
	});

	it("keeps an ignored issue ignored when new events arrive", async () => {
		const { store, call, writer, issue } = await setup();
		const id = await store("AlphaError");
		await call("POST", `/v1/issues/${id}/ignore`, writer);
		await store("AlphaError");
		expect((await issue(id)).status).toBe("ignored");
	});
});

describe("merge", () => {
	it("moves events and counts into the target, and sends later events of a source to the target", async () => {
		const { store, call, writer, issue, ports } = await setup();
		const target = await store("AlphaError");
		const source = await store("BetaError");
		await store("BetaError");
		const merged = await call("POST", `/v1/issues/${target}/merge`, writer, {
			source_ids: [source],
		});
		expect(merged.status).toBe(200);
		expect(merged.body.data).toMatchObject({ id: target, times_seen: 3, stored_events: 3 });
		expect(await issue(source)).toMatchObject({ status: "merged", merged_into: target });
		await store("BetaError");
		expect((await issue(target)).times_seen).toBe(4);
		expect((await issue(source)).times_seen).toBe(2);
		const events = await ports.db.all<{ issue_id: number }>(sql`SELECT issue_id FROM events`);
		expect(events.every((e) => e.issue_id === target)).toBe(true);
		const activity = (await call("GET", "/v1/activity", ADMIN)).body.data;
		expect(activity[0]).toMatchObject({
			action: "issue.merge",
			target_id: target,
			data: { source_ids: [source] },
		});
	});

	it("hides merged issues from the list unless status=merged", async () => {
		const { store, call, writer } = await setup();
		const target = await store("AlphaError");
		const source = await store("BetaError");
		await call("POST", `/v1/issues/${target}/merge`, writer, { source_ids: [source] });
		const ids = (await call("GET", "/v1/issues", ADMIN)).body.data.map((i: { id: number }) => i.id);
		expect(ids).toEqual([target]);
		expect(
			(await call("GET", "/v1/issues?status=merged", ADMIN)).body.data.map(
				(i: { id: number }) => i.id,
			),
		).toEqual([source]);
	});

	it("rejects merging an issue into itself, a merged issue, or an issue of another project", async () => {
		const { store, call, writer, ports } = await setup();
		const a = await store("AlphaError");
		const b = await store("BetaError");
		expect((await call("POST", `/v1/issues/${a}/merge`, writer, { source_ids: [a] })).status).toBe(
			400,
		);
		await call("POST", `/v1/issues/${a}/merge`, writer, { source_ids: [b] });
		expect((await call("POST", `/v1/issues/${b}/merge`, writer, { source_ids: [a] })).status).toBe(
			400,
		);
		const other = await createProject(ports, { name: "Other" });
		const raw = new TextEncoder().encode(JSON.stringify({ message: "other project" }));
		await storeEvent(
			ports,
			new IngestState(),
			other.internalId,
			await prepareEvent(raw, ports.clock.now()),
		);
		const otherIssue = (
			await ports.db.first<{ id: number }>(sql`SELECT id FROM issues ORDER BY id DESC`)
		)?.id;
		expect(
			(await call("POST", `/v1/issues/${a}/merge`, writer, { source_ids: [otherIssue] })).status,
		).toBe(400);
	});
});

describe("approvals (REQUIRE_APPROVAL)", () => {
	it("returns 202 for an action that needs approval, and runs it when an admin approves", async () => {
		const { store, call, writer, issue, token } = await setup({
			requireApproval: ["ignore", "merge"],
		});
		const id = await store("AlphaError");
		const request = await call("POST", `/v1/issues/${id}/ignore`, writer);
		expect(request.status).toBe(202);
		expect(request.body).toMatchObject({
			status: "approval_required",
			approval_id: expect.any(Number),
		});
		expect((await issue(id)).status).toBe("unresolved");
		expect((await call("POST", `/v1/issues/${id}/resolve`, writer)).status).toBe(200); // resolve needs no approval

		const pending = (await call("GET", "/v1/approvals", ADMIN)).body.data;
		expect(pending[0]).toMatchObject({
			action: "ignore",
			issue_id: id,
			status: "pending",
			requested_by: "agent-a",
		});

		const approver = await token("human", ["admin"]);
		expect(
			(await call("POST", `/v1/approvals/${request.body.approval_id}/approve`, approver)).status,
		).toBe(200);
		expect((await issue(id)).status).toBe("ignored");
		expect(
			(await call("POST", `/v1/approvals/${request.body.approval_id}/approve`, approver)).status,
		).toBe(409);
	});

	it("does not let the requester approve its own request, except the bootstrap admin token", async () => {
		const { store, call, token } = await setup({ requireApproval: ["ignore"] });
		const id = await store("AlphaError");
		const admin = await token("admin-agent", ["admin"]);
		const own = await call("POST", `/v1/issues/${id}/ignore`, admin);
		expect(own.status).toBe(202);
		expect(
			(await call("POST", `/v1/approvals/${own.body.approval_id}/approve`, admin)).status,
		).toBe(403);
		expect(
			(await call("POST", `/v1/approvals/${own.body.approval_id}/approve`, ADMIN)).status,
		).toBe(200);
	});

	it("rejects a request, and expires a request after 7 days", async () => {
		const { store, call, writer, clock, issue } = await setup({ requireApproval: ["ignore"] });
		const id = await store("AlphaError");
		const first = await call("POST", `/v1/issues/${id}/ignore`, writer);
		expect(
			(await call("POST", `/v1/approvals/${first.body.approval_id}/reject`, ADMIN)).status,
		).toBe(200);
		expect((await issue(id)).status).toBe("unresolved");
		const second = await call("POST", `/v1/issues/${id}/ignore`, writer);
		clock.advance(7 * 86_400_000 + 1000);
		expect(
			(await call("POST", `/v1/approvals/${second.body.approval_id}/approve`, ADMIN)).status,
		).toBe(409);
		const list = (await call("GET", "/v1/approvals", ADMIN)).body.data;
		expect(list.map((a: { status: string }) => a.status)).toEqual(["expired", "rejected"]);
	});
});
