import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import { STYLES } from "../../../src/http/ui/assets/styles.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { uiApp } from "../../support/ui.ts";

/**
 * The dashboard replaces Home and the cross-app Issues page; an app page shows its own issues
 * first; the Apps list has more facts per app.
 */
async function withData() {
	const ui = await uiApp();
	const session = await ui.signIn();
	const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
	const web = await createProject(ui.ports, { name: "Web", platform: "javascript" });
	await send(
		ui,
		shop,
		errorEvent({ type: "TypeError", fn: "computeTotal", value: "cart is undefined" }),
	);
	ui.clock.advance(60_000);
	await send(
		ui,
		web,
		errorEvent({ type: "RangeError", fn: "paginate", value: "page out of range" }),
	);
	const get = async (path: string, accept = "text/html") => {
		const response = await ui.request(path, { session: session.token, headers: { accept } });
		return { response, body: await response.text() };
	};
	return { ...ui, shop, web, get };
}

describe("the dashboard", () => {
	it("is the home page: a chart with its ranges, and the recent issues of all apps", async () => {
		const { get } = await withData();
		const { response, body } = await get("/");
		expect(response.status).toBe(200);
		expect(body).toContain("<h1>Dashboard</h1>");
		expect(body).toMatch(/<svg class="chart"/);
		for (const range of ["live", "1h", "7d"]) expect(body).toContain(`href="/?range=${range}`);
		// 24 hours is the default range: its link is the dashboard itself.
		expect(body).toMatch(/<a href="\/" aria-current="true">24 h</);
		expect(body).toContain('id="recent-title"');
		expect(body).toContain("cart is undefined");
		expect(body).toContain("page out of range");
		// The app of each issue is named.
		expect(body).toMatch(/recent-app[^>]*>Shop</);
	});

	it("filters the recent issues by status", async () => {
		const { get, ports } = await withData();
		await ports.db.run(
			sql`UPDATE issues SET status = 'regressed' WHERE title LIKE '%paginate%' OR title LIKE '%page out%'`,
		);
		const { body } = await get("/?issues=regressed");
		expect(body).toContain("page out of range");
		expect(body).not.toContain("cart is undefined");
	});

	it("serves the chart data as JSON for the Live view", async () => {
		const { get, shop } = await withData();
		const all = await get("/dashboard/series?range=live", "application/json");
		expect(all.response.status).toBe(200);
		expect(all.response.headers.get("cache-control")).toBe("no-store");
		const data = JSON.parse(all.body);
		expect(data).toMatchObject({ range: "live", unit: "minute", total: 2 });
		expect(data.buckets).toHaveLength(15);
		const one = JSON.parse((await get(`/dashboard/series?range=1h&app=${shop.id}`)).body);
		expect(one.total).toBe(1);
		expect((await get("/dashboard/series?range=year")).response.status).toBe(400);
	});

	it("has no Issues page any more: /issues goes to the dashboard, or to the app with its filters", async () => {
		const { get, shop } = await withData();
		const all = await get("/issues");
		expect(all.response.status).toBe(301);
		expect(all.response.headers.get("location")).toBe("/");
		const one = await get(`/issues?project=${shop.id}&status=unresolved`);
		expect(one.response.headers.get("location")).toBe(`/apps/${shop.id}?status=unresolved`);
		const { body } = await get("/");
		expect(body).not.toContain('href="/issues"');
		expect(body).toMatch(/href="\/"[^>]*>.*Dashboard/);
	});
});

describe("an app page", () => {
	it("shows the chart and the issues of this app first, with filters on the app page", async () => {
		const { get, shop } = await withData();
		const { body } = await get(`/apps/${shop.id}`);
		expect(body).toMatch(/<svg class="chart"/);
		expect(body).toContain("cart is undefined");
		expect(body).not.toContain("page out of range");
		expect(body).toContain(`action="/apps/${shop.id}"`);
		// Setup, the agent prompts and the delete box are in the Setup tab.
		expect(body).not.toContain("Ask your agent</h2>");
		expect(body).not.toContain('id="delete-title"');
		const setup = (await get(`/apps/${shop.id}?tab=setup`)).body;
		expect(setup).toContain("Ask your agent</h2>");
		expect(setup).toContain('id="delete-title"');
	});

	it("filters its issues by search text", async () => {
		const { get, shop } = await withData();
		expect((await get(`/apps/${shop.id}?q=nothing-like-this`)).body).not.toContain(
			"cart is undefined",
		);
		expect((await get(`/apps/${shop.id}?q=cart`)).body).toContain("cart is undefined");
	});
});

describe("the Apps list", () => {
	it("shows events with a sparkline, open issues, the last error and deploy, and setup", async () => {
		const { get } = await withData();
		const { body } = await get("/apps");
		for (const heading of [
			"App",
			"Events, 24 h",
			"Open issues",
			"Last error",
			"Last deploy",
			"Setup",
		]) {
			expect(body).toContain(`>${heading}</th>`);
		}
		expect(body).toMatch(/<svg class="spark"/);
	});

	it("keeps the code-line style out of other .source elements (the column alignment)", () => {
		expect(STYLES).not.toMatch(/(^|\n|\})\s*\.source span/);
	});
});
