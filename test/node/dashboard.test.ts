import { describe, expect, it } from "vitest";
import { claimIssue } from "../../src/core/claims.ts";
import { loadDashboard, recordVisit } from "../../src/core/dashboard.ts";
import { linkFix, recordDeploy, verifyFixes } from "../../src/core/fixes.ts";
import { setIssueStatus } from "../../src/core/issue-actions.ts";
import { type CreatedProject, createProject } from "../../src/core/projects.ts";
import type { Actor } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";
import { errorEvent, send } from "../support/seed.ts";

const HOUR = 3_600_000;
const AGENT: Actor = { type: "token", id: 7, name: "claude-code", scopes: ["issues:write"] };
const PERSON: Actor = { type: "member", id: 1, name: "Simon", scopes: ["admin"] };
const CI: Actor = { type: "token", id: 8, name: "ci", scopes: ["releases:write"] };
const FIX = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

async function setup(config = {}) {
	const t = await testPorts({ config });
	const shop = await createProject(t.ports, { name: "Shop", platform: "node" });
	/** Sends one event and returns the row ID of its issue. */
	const issue = async (project: CreatedProject, fn: string, release = "shop@1.0.0") => {
		await send(t, project, errorEvent({ type: "TypeError", fn, value: `fails in ${fn}`, release }));
		const row = await t.ports.db.first<{ id: number }>(
			sql`SELECT id FROM issues WHERE title LIKE ${`%fails in ${fn}`} ORDER BY id DESC`,
		);
		return row?.id as number;
	};
	const deploy = (project: CreatedProject, release: string, commit = FIX) =>
		recordDeploy(t.ports, CI, {
			project: String(project.id),
			commit,
			release,
			environment: "production",
			commits: [],
			pull_requests: [],
		});
	const load = (since?: Date) =>
		loadDashboard(t.ports, since ?? new Date(t.clock.now().getTime() - 24 * HOUR));
	return { ...t, shop, issue, deploy, load };
}

describe("recordVisit: since your last visit", () => {
	async function withMember() {
		const t = await testPorts();
		await t.ports.db.run(
			sql`INSERT INTO members (id, name, user_handle, created_at) VALUES (1, 'Simon', 'h1', '2026-10-01T00:00:00Z')`,
		);
		return t;
	}

	it("uses the last 24 hours on the first visit", async () => {
		const t = await withMember();
		const visit = await recordVisit(t.ports, 1);
		expect(visit.previous).toBeNull();
		expect(visit.since).toBe("2026-10-09T12:00:00.000Z");
	});

	it("keeps one visit while the member is active, and starts a new one after 30 minutes away", async () => {
		const t = await withMember();
		await recordVisit(t.ports, 1);
		t.clock.advance(10 * 60_000);
		expect((await recordVisit(t.ports, 1)).previous).toBeNull();
		t.clock.advance(2 * 24 * HOUR);
		const back = await recordVisit(t.ports, 1);
		expect(back.previous).toBe("2026-10-10T12:10:00.000Z");
		expect(back.since).toBe("2026-10-10T12:10:00.000Z");
		t.clock.advance(5 * 60_000);
		expect((await recordVisit(t.ports, 1)).since).toBe("2026-10-10T12:10:00.000Z");
	});

	it("writes at most once a minute", async () => {
		const t = await withMember();
		await recordVisit(t.ports, 1);
		t.clock.advance(30_000);
		await recordVisit(t.ports, 1);
		const row = await t.ports.db.first<{ last_visit_at: string }>(
			sql`SELECT last_visit_at FROM members WHERE id = 1`,
		);
		expect(row?.last_visit_at).toBe("2026-10-10T12:00:00.000Z");
	});

	it("looks back at most 30 days", async () => {
		const t = await withMember();
		await recordVisit(t.ports, 1);
		t.clock.advance(90 * 24 * HOUR);
		const visit = await recordVisit(t.ports, 1);
		expect(visit.previous).toBe("2026-10-10T12:00:00.000Z");
		expect(visit.since).toBe(new Date(t.clock.now().getTime() - 30 * 24 * HOUR).toISOString());
	});
});

describe("loadDashboard", () => {
	it("is empty and calm with no issues", async () => {
		const d = await setup();
		const data = await d.load();
		expect(data.summary).toEqual({ new_issues: 0, verified: 0, regressed: 0, agent_actions: 0 });
		expect(data.attention).toEqual([]);
		expect(data.loop).toEqual({
			open: 0,
			claimed: 0,
			fix_linked: 0,
			fix_deployed: 0,
			regressed: 0,
			verified_7d: 0,
		});
		expect(data.apps.map((a) => a.name)).toEqual(["Shop"]);
	});

	it("counts what changed since the visit: new issues, verified and regressed fixes, agent actions", async () => {
		const d = await setup({ verifyQuietHours: 1 });
		const old = await d.issue(d.shop, "oldFn");
		d.clock.advance(48 * HOUR);
		const since = d.clock.now();
		d.clock.advance(HOUR);
		const fresh = await d.issue(d.shop, "freshFn");
		await claimIssue(d.ports, AGENT, fresh);
		await linkFix(d.ports, AGENT, old, { commit: FIX });
		await d.deploy(d.shop, "shop@2.0.0");
		d.clock.advance(2 * HOUR);
		await verifyFixes(d.ports, d.clock.now());

		const data = await d.load(since);
		expect(data.summary.new_issues).toBe(1);
		expect(data.summary.verified).toBe(1);
		expect(data.summary.regressed).toBe(0);
		// The claim and the fix link. Deploy records (by CI) are not agent actions.
		expect(data.summary.agent_actions).toBe(2);
		expect(data.loop.verified_7d).toBe(1);
		expect(data.outcomes.verified).toBe(1);
		expect(data.outcomes.median_hours_to_verified).toBe(2);
	});

	it("lists what needs a person, the most serious first", async () => {
		const d = await setup({ requireApproval: ["ignore"] });
		const regressed = await d.issue(d.shop, "regressedFn");
		const failing = await d.issue(d.shop, "failingFn");
		const waiting = await d.issue(d.shop, "waitingFn");
		const expired = await d.issue(d.shop, "expiredFn");
		const unclaimed = await d.issue(d.shop, "unclaimedFn");
		const approval = await d.issue(d.shop, "approvalFn");

		await linkFix(d.ports, AGENT, regressed, { commit: FIX });
		await linkFix(d.ports, AGENT, failing, { commit: FIX });
		await d.deploy(d.shop, "shop@2.0.0");
		await linkFix(d.ports, AGENT, waiting, {
			commit: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		});
		await claimIssue(d.ports, AGENT, expired, 30);
		await setIssueStatus(d.ports, AGENT, approval, "ignored");
		d.clock.advance(25 * HOUR);
		await claimIssue(d.ports, AGENT, approval);
		// The error comes back in the release with the fix: a regression.
		await d.issue(d.shop, "regressedFn", "shop@2.0.0");
		// An event from a release without a deploy: the quiet period starts again.
		await d.issue(d.shop, "failingFn", "shop@unknown");

		const data = await d.load();
		const kinds = data.attention.map((a) => [a.kind, a.issue?.id]);
		expect(kinds).toEqual([
			["approval", approval],
			["regressed", regressed],
			["still_failing", failing],
			["not_deployed", waiting],
			["expired_claim", expired],
			["unclaimed", unclaimed],
		]);
		const notDeployed = data.attention.find((a) => a.kind === "not_deployed");
		expect(notDeployed?.app_has_deploys).toBe(true);
		const approvalItem = data.attention.find((a) => a.kind === "approval");
		expect(approvalItem?.detail).toBe("ignore");
		expect(approvalItem?.actor).toBe("claude-code");
		expect(data.attention.every((a) => a.issue?.project_name === "Shop")).toBe(true);

		expect(data.loop).toEqual({
			open: 2,
			claimed: 1,
			fix_linked: 1,
			fix_deployed: 1,
			regressed: 1,
			verified_7d: 0,
		});
	});

	it("gives agents an hour before an unclaimed issue needs a person", async () => {
		const d = await setup();
		await d.issue(d.shop, "brandNew");
		expect((await d.load()).attention).toEqual([]);
		d.clock.advance(2 * HOUR);
		expect((await d.load()).attention.map((a) => a.kind)).toEqual(["unclaimed"]);
	});

	it("shows at most 5 items of one kind, with the total", async () => {
		const d = await setup();
		for (let n = 0; n < 7; n++) await d.issue(d.shop, `fn${n}`);
		d.clock.advance(2 * HOUR);
		const data = await d.load();
		expect(data.attention).toHaveLength(5);
		expect(data.totals.unclaimed).toBe(7);
	});

	it("leaves out test issues and deleted apps", async () => {
		const d = await setup();
		const other = await createProject(d.ports, { name: "Gone" });
		await d.issue(other, "goneFn");
		const test = await d.issue(d.shop, "testFn");
		await d.ports.db.run(sql`UPDATE issues SET test = 1 WHERE id = ${test}`);
		await d.ports.db.run(
			sql`UPDATE projects SET deleted_at = ${d.clock.now().toISOString()} WHERE id = ${other.internalId}`,
		);
		d.clock.advance(2 * HOUR);
		const data = await d.load(new Date(0));
		expect(data.summary.new_issues).toBe(0);
		expect(data.attention).toEqual([]);
		expect(data.apps.map((a) => a.name)).toEqual(["Shop"]);
	});

	it("shows each app with its last 24 hours, open issues and the last deploy", async () => {
		const d = await setup();
		await d.issue(d.shop, "a");
		d.clock.advance(3 * HOUR);
		await d.issue(d.shop, "a");
		await d.issue(d.shop, "b");
		await d.deploy(d.shop, "shop@2.0.0");
		const [app] = (await d.load()).apps;
		expect(app?.events_24h).toBe(3);
		expect(app?.open_issues).toBe(2);
		expect(app?.last_deploy_at).toBe(d.clock.now().toISOString());
		expect(app?.hourly).toHaveLength(24);
		expect(app?.hourly.at(-1)).toBe(2);
		expect(app?.hourly.at(-4)).toBe(1);
	});

	it("lists recent activity with the issue and the app", async () => {
		const d = await setup();
		const id = await d.issue(d.shop, "a");
		await claimIssue(d.ports, AGENT, id);
		await setIssueStatus(d.ports, PERSON, id, "resolved");
		const data = await d.load();
		expect(data.activity.slice(0, 2).map((a) => [a.action, a.actor_name, a.issue?.id])).toEqual([
			["issue.resolve", "Simon", id],
			["issue.claim", "claude-code", id],
		]);
		expect(data.activity[0]?.issue?.project_name).toBe("Shop");
	});
});
