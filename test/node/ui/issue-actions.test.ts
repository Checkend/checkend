import { describe, expect, it } from "vitest";
import type { FrontIdentity } from "../../../src/core/auth/front-identity.ts";
import { createProject } from "../../../src/core/projects.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { UI_ADMIN_TOKEN, UI_SETUP_CODE, uiApp } from "../../support/ui.ts";

/** A signed-in member, two issues of one app, and helpers for the issue page and its forms. */
async function withIssues(config = {}) {
	const ui = await uiApp(config);
	const session = await ui.signIn();
	const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
	await send(
		ui,
		shop,
		errorEvent({ type: "TypeError", fn: "computeTotal", value: "cart is undefined" }),
		errorEvent({ type: "RangeError", fn: "paginate", value: "page out of range" }),
	);
	const [first, second] = (
		await ui.ports.db.all<{ id: number }>(sql`SELECT id FROM issues ORDER BY id`)
	).map((row) => row.id) as [number, number];
	const page = async (id: number, query = "") => {
		const response = await ui.request(`/issues/${id}${query}`, {
			session: session.token,
			headers: { accept: "text/html" },
		});
		return { response, html: await response.text() };
	};
	const act = (id: number, action: string, csrf = session.csrf, headers?: Record<string, string>) =>
		ui.form(`/issues/${id}/${action}`, { _csrf: csrf }, session.token, headers);
	const api = (method: string, path: string) =>
		ui.request(path, { method, headers: { authorization: `Bearer ${UI_ADMIN_TOKEN}` } });
	const issue = (id: number) =>
		ui.ports.db.first<{
			status: string;
			claimed_by: string | null;
			claim_expires_at: string | null;
		}>(sql`SELECT status, claimed_by, claim_expires_at FROM issues WHERE id = ${id}`);
	const activity = (id: number) =>
		ui.ports.db.all<{
			action: string;
			actor_type: string;
			actor_name: string;
			data: string | null;
		}>(
			sql`SELECT action, actor_type, actor_name, data FROM activity
				WHERE target_type = 'issue' AND target_id = ${id} ORDER BY id`,
		);
	const setStatus = (id: number, status: string) =>
		ui.ports.db.run(sql`UPDATE issues SET status = ${status} WHERE id = ${id}`);
	return { ...ui, session, shop, first, second, page, act, api, issue, activity, setStatus };
}

/** The action forms of a page: the path after /issues/<id>/ of each form. */
const formsOf = (html: string, id: number) =>
	[...html.matchAll(new RegExp(`action="/issues/${id}/([a-z]+)"`, "g"))].map((m) => m[1]);

describe("issue page: Fix this", () => {
	it("has a Copy prompt button with the issue ID, the brief, claim and link_fix, and no secrets", async () => {
		const t = await withIssues();
		const { html } = await t.page(t.first);
		const prompt = /data-copy-text="([^"]*)"/.exec(html)?.[1]?.replaceAll("&#39;", "'") ?? "";
		expect(prompt).toContain(`Checkend issue ${t.first}`);
		expect(prompt).toContain(`ce issue view ${t.first}`);
		expect(prompt).toContain("get_issue_brief");
		expect(prompt).toContain("claim_issue");
		expect(prompt).toContain("link_fix");
		expect(prompt).toContain(`https://checkend.test/issues/${t.first}`);
		// Never the title or event data (free text), and never a secret.
		expect(prompt).not.toContain("cart is undefined");
		for (const secret of [UI_ADMIN_TOKEN, UI_SETUP_CODE, t.session.csrf, t.session.token]) {
			expect(prompt).not.toContain(secret);
		}
		expect(prompt).not.toMatch(/ck_[A-Za-z0-9_-]{20,}/);
		const keys = await t.ports.db.all<{ public_key: string }>(
			sql`SELECT public_key FROM project_keys`,
		);
		for (const key of keys) expect(html).not.toContain(key.public_key);
		// No inline script: the static copy client handles data-copy-text.
		expect(html).not.toMatch(/<script>|onclick=/);
	});

	it("shows the same steps as commands, with the token from an environment variable", async () => {
		const t = await withIssues();
		const { html } = await t.page(t.first);
		expect(html).toContain(`ce issue view ${t.first}`);
		expect(html).toContain(`https://checkend.test/v1/issues/${t.first}/claim`);
		expect(html).toContain(`https://checkend.test/v1/issues/${t.first}/fix`);
		expect(html).toContain("$CHECKEND_TOKEN");
	});
});

describe("issue page: human actions", () => {
	it("resolves, ignores and unresolves for a member, with a 303 back to the issue and a notice", async () => {
		const t = await withIssues();
		const resolved = await t.act(t.first, "resolve");
		expect(resolved.status).toBe(303);
		expect(resolved.headers.get("location")).toBe(`/issues/${t.first}?done=resolve`);
		expect((await t.issue(t.first))?.status).toBe("resolved");
		const notice = (await t.page(t.first, "?done=resolve")).html;
		expect(notice).toMatch(/class="notice"[^>]*>[^<]*resolved/i);

		const reopened = await t.act(t.first, "unresolve");
		expect(reopened.headers.get("location")).toBe(`/issues/${t.first}?done=unresolve`);
		expect((await t.issue(t.first))?.status).toBe("unresolved");

		const ignored = await t.act(t.first, "ignore");
		expect(ignored.headers.get("location")).toBe(`/issues/${t.first}?done=ignore`);
		expect((await t.issue(t.first))?.status).toBe("ignored");
	});

	it("changes the state and the activity the same way as the API", async () => {
		const t = await withIssues();
		for (const action of ["resolve", "unresolve", "ignore"]) {
			expect((await t.act(t.first, action)).status).toBe(303);
			expect((await t.api("POST", `/v1/issues/${t.second}/${action}`)).status).toBe(200);
		}
		expect((await t.act(t.first, "claim")).status).toBe(303);
		expect((await t.api("POST", `/v1/issues/${t.second}/claim`)).status).toBe(200);
		expect((await t.act(t.first, "release")).status).toBe(303);
		expect((await t.api("POST", `/v1/issues/${t.second}/release`)).status).toBe(200);

		expect((await t.issue(t.first))?.status).toBe((await t.issue(t.second))?.status);
		const ui = await t.activity(t.first);
		const api = await t.activity(t.second);
		expect(ui.map((a) => a.action)).toEqual(api.map((a) => a.action));
		expect(ui.map((a) => a.action)).toEqual([
			"issue.resolve",
			"issue.unresolve",
			"issue.ignore",
			"issue.claim",
			"issue.release",
		]);
		expect(ui.map((a) => a.data)).toEqual(api.map((a) => a.data));
		// The UI rows name the signed-in member.
		for (const row of ui) expect(row.actor_type).toBe("member");
	});

	it("claims for the signed-in member; the page shows who holds it and until when", async () => {
		const t = await withIssues();
		const claimed = await t.act(t.first, "claim");
		expect(claimed.headers.get("location")).toBe(`/issues/${t.first}?done=claim`);
		const row = await t.issue(t.first);
		const member = await t.ports.db.first<{ name: string }>(sql`SELECT name FROM members`);
		expect(row?.claimed_by).toBe(member?.name);
		const { html } = await t.page(t.first);
		expect(html).toContain(`datetime="${row?.claim_expires_at}"`);
		expect(html).toMatch(/Claimed by[^<]*<strong>/);
		expect(formsOf(html, t.first)).toContain("release");
		expect(formsOf(html, t.first)).not.toContain("claim");

		const released = await t.act(t.first, "release");
		expect(released.headers.get("location")).toBe(`/issues/${t.first}?done=release`);
		expect((await t.issue(t.first))?.claimed_by).toBe(null);
	});

	it("does not take a claim that another actor holds", async () => {
		const t = await withIssues();
		expect((await t.api("POST", `/v1/issues/${t.first}/claim`)).status).toBe(200);
		const { html } = await t.page(t.first);
		expect(html).toMatch(/Claimed by[^<]*<strong>ADMIN_TOKEN<\/strong>/);
		expect(formsOf(html, t.first)).not.toContain("claim");
		const refused = await t.act(t.first, "claim");
		expect(refused.headers.get("location")).toBe(`/issues/${t.first}?done=claim_taken`);
		expect((await t.issue(t.first))?.claimed_by).toBe("ADMIN_TOKEN");
	});

	it("checks the CSRF token and the origin of every action", async () => {
		const t = await withIssues();
		for (const action of ["resolve", "ignore", "unresolve", "claim", "release"]) {
			expect((await t.act(t.first, action, "wrong")).status, action).toBe(403);
			const crossSite = await t.act(t.first, action, t.session.csrf, {
				origin: "https://evil.example",
			});
			expect(crossSite.status, action).toBe(403);
		}
		expect((await t.issue(t.first))?.status).toBe("unresolved");
		expect(await t.activity(t.first)).toEqual([]);
	});

	it("needs a signed-in member, and answers 404 for an unknown issue", async () => {
		const t = await withIssues();
		const anonymous = await t.form(`/issues/${t.first}/resolve`, { _csrf: t.session.csrf });
		expect(anonymous.status).toBe(303);
		expect(anonymous.headers.get("location")).toBe("/login");
		expect((await t.issue(t.first))?.status).toBe("unresolved");
		expect((await t.act(999999, "resolve")).status).toBe(404);
	});

	it("shows only the actions that make sense for the state", async () => {
		const t = await withIssues();
		const cases: [string, string[]][] = [
			["unresolved", ["resolve", "ignore", "claim"]],
			["regressed", ["resolve", "ignore", "claim"]],
			["resolved", ["unresolve"]],
			["ignored", ["unresolve"]],
			["fix_pending", []],
			["verified", []],
			["merged", []],
		];
		for (const [status, forms] of cases) {
			await t.setStatus(t.first, status);
			const { html } = await t.page(t.first);
			expect(formsOf(html, t.first).sort(), status).toEqual([...forms].sort());
		}
	});

	it("asks for a confirmation before Ignore", async () => {
		const t = await withIssues();
		const { html } = await t.page(t.first);
		expect(html).toMatch(
			new RegExp(
				`<details class="confirm[^"]*">\\s*<summary>Ignore</summary>\\s*<form method="post" action="/issues/${t.first}/ignore">`,
			),
		);
	});

	it("never calls a manual resolve verified", async () => {
		const t = await withIssues();
		await t.act(t.first, "resolve");
		const { html } = await t.page(t.first, "?done=resolve");
		const main = html.slice(html.indexOf("<main"));
		expect(main).not.toMatch(/verified/i);
		// The resolve button says what it does.
		await t.setStatus(t.first, "unresolved");
		const open = (await t.page(t.first)).html;
		expect(open).toMatch(/not a verified fix|Checkend verifies a fix only after a deploy/i);
	});

	it("does not show a notice for an unknown done value", async () => {
		const t = await withIssues();
		const { html } = await t.page(t.first, "?done=%3Cscript%3E");
		expect(html).not.toContain('class="notice"');
		expect(html).not.toContain("<script>");
	});

	it("waits for an approval when this install needs one for ignore", async () => {
		const t = await withIssues({ requireApproval: ["ignore"] });
		const ignored = await t.act(t.first, "ignore");
		expect(ignored.headers.get("location")).toBe(`/issues/${t.first}?done=approval`);
		expect((await t.issue(t.first))?.status).toBe("unresolved");
		expect((await t.page(t.first, "?done=approval")).html).toMatch(/approval/i);
	});
});

describe("issue actions in a hosted install", () => {
	const ORIGIN = "https://hosted.test";
	const BASE = "/k7q2x9";
	const OWNER: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };
	const MEMBER: FrontIdentity = { accountId: "acc2bob", name: "Bob", role: "member" };

	async function hosted() {
		const ui = await uiApp(
			{ publicUrl: ORIGIN, basePath: BASE, trustedFront: true, spacesUrl: `${ORIGIN}/spaces` },
			ORIGIN,
		);
		const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
		const sent = await ui.request(`${BASE}/api/${shop.id}/envelope/?sentry_key=${shop.publicKey}`, {
			method: "POST",
			body: `{}\n{"type":"event"}\n${JSON.stringify(errorEvent())}\n`,
		});
		expect(sent.status).toBe(200);
		await ui.settle();
		const id = Number((await ui.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id);
		const call = (path: string, as: FrontIdentity, init: RequestInit = {}) =>
			ui.request(`${BASE}${path}`, { ...init, identity: as });
		const csrfOf = async (as: FrontIdentity) =>
			/name="_csrf" value="([^"]+)"/.exec(await (await call(`/issues/${id}`, as)).text())?.[1] ??
			"";
		const act = async (action: string, as: FrontIdentity) =>
			call(`/issues/${id}/${action}`, as, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					origin: ORIGIN,
					referer: `${ORIGIN}${BASE}/issues/${id}`,
				},
				body: new URLSearchParams({ _csrf: await csrfOf(as) }).toString(),
			});
		return { ...ui, id, call, act };
	}

	it("posts the forms under the base path, redirects there, and a member (not an owner) can act", async () => {
		const t = await hosted();
		const html = await (
			await t.call(`/issues/${t.id}`, MEMBER, { headers: { accept: "text/html" } })
		).text();
		expect(html).toContain(`action="${BASE}/issues/${t.id}/resolve"`);
		expect(html).toContain(`${ORIGIN}${BASE}/issues/${t.id}`);
		expect(html).toContain(`${ORIGIN}${BASE}/v1/issues/${t.id}/claim`);
		const claimed = await t.act("claim", MEMBER);
		expect(claimed.status).toBe(303);
		expect(claimed.headers.get("location")).toBe(`${BASE}/issues/${t.id}?done=claim`);
		const resolved = await t.act("resolve", MEMBER);
		expect(resolved.headers.get("location")).toBe(`${BASE}/issues/${t.id}?done=resolve`);
		const row = await t.ports.db.first<{ status: string; claimed_by: string }>(
			sql`SELECT status, claimed_by FROM issues WHERE id = ${t.id}`,
		);
		expect(row).toEqual({ status: "resolved", claimed_by: "Bob" });
	});

	it("a member cannot release the claim of another member; an owner can", async () => {
		const t = await hosted();
		await t.act("claim", OWNER);
		const page = await (await t.call(`/issues/${t.id}`, MEMBER)).text();
		expect(page).not.toContain(`action="${BASE}/issues/${t.id}/release"`);
		const refused = await t.act("release", MEMBER);
		expect(refused.headers.get("location")).toBe(`${BASE}/issues/${t.id}?done=not_holder`);
		// Bob's claim does not replace Alice's.
		const taken = await t.act("claim", MEMBER);
		expect(taken.headers.get("location")).toBe(`${BASE}/issues/${t.id}?done=claim_taken`);
		const owner = await (await t.call(`/issues/${t.id}`, OWNER)).text();
		expect(owner).toMatch(/Claimed by[^<]*<strong>Alice<\/strong>/);
		// An owner can release the claim of another member, after a confirmation.
		await t.act("release", OWNER);
		await t.act("claim", MEMBER);
		const forBob = await (await t.call(`/issues/${t.id}`, OWNER)).text();
		expect(forBob).toMatch(/Claimed by[^<]*<strong>Bob<\/strong>/);
		expect(forBob).toMatch(
			new RegExp(
				`<details class="confirm[^"]*">\\s*<summary>Release[^<]*</summary>\\s*<form method="post" action="${BASE}/issues/${t.id}/release">`,
			),
		);
		const released = await t.act("release", OWNER);
		expect(released.headers.get("location")).toBe(`${BASE}/issues/${t.id}?done=release`);
	});
});
