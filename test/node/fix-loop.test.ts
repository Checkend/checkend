import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { runScheduled } from "../../src/core/scheduler.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { expectSpecBrief } from "../support/brief-check.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "fix-loop-admin-token-0123456789";
const FIX = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
const OTHER = "ffffffffffffffffffffffffffffffffffffffff";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const store = async (release: string, user = "u1") => {
		const raw = {
			exception: { values: [{ type: "TypeError", value: "cart total failed" }] },
			release,
			user: { id: user },
		};
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
	const ci = (
		await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "ci", scopes: ["releases:write"] })
	).token;
	const deploy = (body: Record<string, unknown>) =>
		call("POST", "/v1/deploys", ci, { project: project.id, ...body });
	const status = async (id: number) =>
		(await call("GET", `/v1/issues/${id}`, ADMIN)).body.data.status;
	const cron = () => runScheduled(t.ports, t.clock.now());
	return { ...t, project, store, call, agent, ci, deploy, status, cron };
}

describe("the fix loop: link_fix, deploy, verify, regress", () => {
	it("verifies a fix after a quiet period when the deploy contains the fix commit", async () => {
		const { store, call, agent, deploy, status, cron, clock } = await setup();
		const id = await store("shop@1.0.0");
		const linked = await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		expect(linked.status).toBe(200);
		expect(linked.body.data).toMatchObject({
			status: "fix_pending",
			fix: { kind: "commit", commit: FIX, linked_by: "agent", deployed_at: null, outcome: null },
		});

		const deployed = await deploy({
			release: "shop@1.0.1",
			commit: FIX,
			environment: "production",
		});
		expect(deployed.status).toBe(201);
		expect(deployed.body.data).toMatchObject({
			release: "shop@1.0.1",
			environment: "production",
			fixes_deployed: [id],
		});

		clock.advance(23 * 3600_000);
		await cron();
		expect(await status(id)).toBe("fix_pending");
		clock.advance(2 * 3600_000);
		await cron();
		expect(await status(id)).toBe("verified");
		const fix = (await call("GET", `/v1/issues/${id}`, ADMIN)).body.data.fix;
		expect(fix).toMatchObject({
			outcome: "verified",
			release: "shop@1.0.1",
			environment: "production",
		});
	});

	it("regresses when the error comes back in a release that contains the fix, not in an older release", async () => {
		const { store, call, agent, deploy, status, clock } = await setup();
		const id = await store("shop@1.0.0");
		await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		await deploy({ release: "shop@1.0.1", commit: OTHER, commits: [FIX, OTHER] });
		clock.advance(60_000);
		await store("shop@1.0.0"); // an old server still runs the old release
		expect(await status(id)).toBe("fix_pending");
		await store("shop@1.0.1");
		expect(await status(id)).toBe("regressed");
		const issue = (await call("GET", `/v1/issues/${id}`, ADMIN)).body.data;
		expect(issue.fix).toMatchObject({ outcome: "regressed" });
		const activity = (await call("GET", `/v1/issues/${id}/activity`, ADMIN)).body.data;
		expect(activity[0]).toMatchObject({
			action: "issue.regress",
			actor_type: "system",
			data: { release: "shop@1.0.1" },
		});
	});

	it("counts a later release in the same environment as containing the fix", async () => {
		const { store, call, agent, deploy, status } = await setup();
		const id = await store("shop@1.0.0");
		await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		await deploy({ release: "shop@1.0.1", commit: FIX });
		await deploy({ release: "shop@1.0.2", commit: OTHER });
		await store("shop@1.0.2");
		expect(await status(id)).toBe("regressed");
	});

	it("marks a fix as deployed when the deploy happened before link_fix", async () => {
		const { store, call, agent, deploy } = await setup();
		const id = await store("shop@1.0.0");
		await deploy({ release: "shop@1.0.1", commit: FIX });
		const linked = await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		expect(linked.body.data.fix).toMatchObject({
			release: "shop@1.0.1",
			deployed_at: expect.any(String),
		});
	});

	it("does not verify a fix that is not deployed", async () => {
		const { store, call, agent, status, cron, clock } = await setup();
		const id = await store("shop@1.0.0");
		await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		clock.advance(48 * 3600_000);
		await cron();
		expect(await status(id)).toBe("fix_pending");
	});

	it("links a PR URL; a deploy that lists the PR contains the fix", async () => {
		const { store, call, agent, deploy } = await setup();
		const id = await store("shop@1.0.0");
		const pr = "https://github.com/acme/shop/pull/42";
		expect(
			(await call("POST", `/v1/issues/${id}/fix`, agent, { pr_url: pr })).body.data.fix,
		).toMatchObject({ kind: "pr", pr_url: pr });
		const deployed = await deploy({ release: "shop@1.0.1", commit: OTHER, pull_requests: [pr] });
		expect(deployed.body.data.fixes_deployed).toEqual([id]);
	});

	it("validates link_fix and deploy input", async () => {
		const { store, call, agent, deploy, ci } = await setup();
		const id = await store("shop@1.0.0");
		for (const body of [
			{},
			{ commit: "xyz" },
			{ pr_url: "http://github.com/acme/shop/pull/1" },
			{ pr_url: "https://evil.example/acme/shop/pull/1" },
			{ commit: FIX, pr_url: "https://github.com/acme/shop/pull/1" },
		]) {
			expect(
				(await call("POST", `/v1/issues/${id}/fix`, agent, body)).status,
				JSON.stringify(body),
			).toBe(400);
		}
		expect((await call("POST", `/v1/issues/${id}/fix`, ci, { commit: FIX })).status).toBe(403);
		expect((await deploy({ commit: "nope" })).status).toBe(400);
		expect(
			(await call("POST", "/v1/deploys", agent, { project: "shop", commit: FIX })).status,
		).toBe(403);
		expect(
			(await call("POST", "/v1/deploys", ci, { project: "no-such", commit: FIX })).status,
		).toBe(404);
	});

	it("lists releases with their deploys", async () => {
		const { deploy, call, project } = await setup();
		await deploy({ release: "shop@1.0.1", commit: FIX, environment: "staging" });
		await deploy({ release: "shop@1.0.1", commit: FIX, environment: "production" });
		const releases = (await call("GET", `/v1/releases?project=${project.id}`, ADMIN)).body.data;
		expect(releases).toEqual([
			expect.objectContaining({
				version: "shop@1.0.1",
				commit: FIX,
				deploys: [
					expect.objectContaining({ environment: "production" }),
					expect.objectContaining({ environment: "staging" }),
				],
			}),
		]);
	});

	it("shows the fix in the brief", async () => {
		const { store, call, agent, deploy, ports } = await setup();
		const id = await store("shop@1.0.0");
		await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		await deploy({ release: "shop@1.0.1", commit: FIX });
		const brief = await buildBrief(ports.db, id, ports.clock.now());
		expectSpecBrief(brief);
		expect((brief?.json.issue as Record<string, unknown> | undefined)?.fix).toMatchObject({
			commit: FIX,
			release: "shop@1.0.1",
		});
		expect(brief?.markdown).toContain(
			`| Fix | commit ${FIX.slice(0, 12)} by agent, deployed in shop@1.0.1 (production), waiting for verification |`,
		);
	});

	it("records fix outcomes for analysis (GET /v1/fix-outcomes)", async () => {
		const { store, call, agent, deploy, cron, clock } = await setup();
		const id = await store("shop@1.0.0");
		await call("POST", `/v1/issues/${id}/fix`, agent, { commit: FIX });
		await deploy({ release: "shop@1.0.1", commit: FIX });
		clock.advance(25 * 3600_000);
		await cron();
		const outcomes = (await call("GET", "/v1/fix-outcomes", ADMIN)).body.data;
		expect(outcomes).toEqual([
			expect.objectContaining({
				issue_id: id,
				outcome: "verified",
				linked_by: "agent",
				kind: "commit",
				hours_to_verified: 25,
			}),
		]);
	});
});
