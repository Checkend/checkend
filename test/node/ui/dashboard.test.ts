import { describe, expect, it } from "vitest";
import { claimIssue } from "../../../src/core/claims.ts";
import { linkFix, recordDeploy } from "../../../src/core/fixes.ts";
import { createProject } from "../../../src/core/projects.ts";
import type { Actor } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { uiApp } from "../../support/ui.ts";

const HOUR = 3_600_000;
const AGENT: Actor = { type: "token", id: 7, name: "claude-code", scopes: ["issues:write"] };
const FIX = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

async function withApp() {
	const ui = await uiApp();
	const session = await ui.signIn();
	const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
	const page = async (path = "/") =>
		(await ui.request(path, { session: session.token, headers: { accept: "text/html" } })).text();
	const issue = async (fn: string, value: string, release = "shop@1.0.0") => {
		await send(ui, shop, errorEvent({ type: "TypeError", fn, value, release }));
		return (
			await ui.ports.db.first<{ id: number }>(
				sql`SELECT id FROM issues WHERE culprit LIKE ${`${fn} %`} ORDER BY id DESC`,
			)
		)?.id as number;
	};
	return { ...ui, session, shop, page, issue };
}

const section = (html: string, id: string) =>
	new RegExp(`<section[^>]*aria-labelledby="${id}"[\\s\\S]*?</section>`).exec(html)?.[0] ?? "";

describe("the dashboard page", () => {
	it("lists a regression in Needs you, with the issue link and the release", async () => {
		const d = await withApp();
		const id = await d.issue("computeTotal", "cart failed");
		await linkFix(d.ports, AGENT, id, { commit: FIX });
		await recordDeploy(d.ports, AGENT, {
			project: String(d.shop.id),
			commit: FIX,
			release: "shop@2.0.0",
			environment: "production",
			commits: [],
			pull_requests: [],
		});
		await d.issue("computeTotal", "cart failed", "shop@2.0.0");
		const attn = section(await d.page(), "attn-title");
		expect(attn).toContain(">Regressed</span>");
		expect(attn).toContain(`href="/issues/${id}"`);
		expect(attn).toContain("shop@2.0.0");
	});

	it("escapes text from events and agents", async () => {
		const d = await withApp();
		await d.issue("render", "<img src=x onerror=alert(1)>");
		d.clock.advance(2 * HOUR);
		const html = await d.page();
		expect(html).not.toContain("<img src=x");
		expect(html).toContain("&lt;img src=x");
		expect(html).not.toMatch(/\sstyle="/);
	});

	it("says since when it counts: the last 24 hours, then since the last visit", async () => {
		const d = await withApp();
		expect(await d.page()).toContain("In the last 24 hours.");
		d.clock.advance(2 * 24 * HOUR);
		expect(await d.page()).toContain("Since your last visit, 2 d ago.");
	});

	it("shows the agent activity and the apps with a sparkline", async () => {
		const d = await withApp();
		const id = await d.issue("computeTotal", "cart failed");
		await claimIssue(d.ports, AGENT, id);
		const html = await d.page();
		const activity = section(html, "activity-title");
		expect(activity).toContain('claude-code</span> <span class="muted">(agent)</span> claimed');
		expect(activity).toContain(`href="/issues/${id}"`);
		const apps = section(html, "apps-title");
		expect(apps).toContain(`href="/apps/${d.shop.id}"`);
		expect(apps).toContain('<svg class="spark"');
		expect(section(html, "loop-title")).toMatch(
			/stage-n">1<\/span><span class="stage-label">Claimed/,
		);
	});
});
