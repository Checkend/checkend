import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import { CSP } from "../../../src/http/ui/security.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { uiApp } from "../../support/ui.ts";

async function withData() {
	const ui = await uiApp();
	const session = await ui.signIn();
	const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
	const web = await createProject(ui.ports, { name: "Web", platform: "javascript" });
	await send(
		ui,
		shop,
		errorEvent({ type: "TypeError", fn: "computeTotal", value: "cart is undefined" }),
		errorEvent({ type: "TypeError", fn: "computeTotal", value: "cart is undefined" }),
	);
	ui.clock.advance(60_000);
	await send(
		ui,
		web,
		errorEvent({
			type: "RangeError",
			fn: "paginate",
			value: "page out of range",
			environment: "staging",
		}),
	);
	const issues = await ui.ports.db.all<{ id: number; title: string }>(
		sql`SELECT id, title FROM issues ORDER BY id`,
	);
	const events = await ui.ports.db.all<{ id: number; issue_id: number }>(
		sql`SELECT id, issue_id FROM events ORDER BY id`,
	);
	const page = async (path: string) => {
		const response = await ui.request(path, {
			session: session.token,
			headers: { accept: "text/html" },
		});
		return { response, html: await response.text() };
	};
	return { ...ui, session, shop, web, issues, events, page };
}

/** Every UI page, for the checks that apply to all of them. */
const pagesOf = (d: Awaited<ReturnType<typeof withData>>) => [
	"/issues",
	"/issues?status=unresolved&environment=staging",
	`/issues/${d.issues[0]?.id}`,
	`/events/${d.events[0]?.id}`,
	"/projects",
	`/projects/${d.shop.id}`,
	"/settings",
];

describe("every page", () => {
	it("has a strict Content-Security-Policy and other security headers", async () => {
		const d = await withData();
		const paths = [...pagesOf(d), "/login", "/setup", "/issues/999999", "/no-such-page"];
		for (const path of paths) {
			const { response } = await d.page(path);
			expect(response.headers.get("content-security-policy"), path).toBe(CSP);
			expect(response.headers.get("x-content-type-options"), path).toBe("nosniff");
			expect(response.headers.get("x-frame-options"), path).toBe("DENY");
			expect(response.headers.get("referrer-policy"), path).toBe("same-origin");
			expect(response.headers.get("cache-control"), path).toBe("no-store");
		}
		expect(CSP).toContain("script-src 'self'");
		expect(CSP).toContain("frame-ancestors 'none'");
		expect(CSP).not.toContain("unsafe-inline");
		expect(CSP).not.toContain("unsafe-eval");
	});

	it("has no inline script, inline style or event handler attribute", async () => {
		const d = await withData();
		for (const path of [...pagesOf(d), "/login", "/setup"]) {
			const { html } = await d.page(path);
			expect(html, path).toMatch(/^<!doctype html>/i);
			expect(html, path).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
			expect(html, path).not.toMatch(/\sstyle=/i);
			expect(html, path).not.toMatch(/\son[a-z]+=/i);
		}
	});

	it("is usable on a phone and has a main landmark and a skip link", async () => {
		const d = await withData();
		for (const path of pagesOf(d)) {
			const { html } = await d.page(path);
			expect(html, path).toContain(
				'<meta name="viewport" content="width=device-width, initial-scale=1">',
			);
			expect(html, path).toContain('<main id="main"');
			expect(html, path).toContain('href="#main"');
		}
	});

	it("never shows the internal project row ID", async () => {
		const d = await withData();
		const projects = await d.ports.db.all<{ id: number; public_id: number }>(
			sql`SELECT id, public_id FROM projects`,
		);
		for (const path of pagesOf(d)) {
			const { html } = await d.page(path);
			for (const p of projects) {
				expect(html, path).not.toMatch(new RegExp(`project=${p.id}\\b|/projects/${p.id}\\b`));
			}
		}
		const { html } = await d.page("/projects");
		expect(html).toContain(`/projects/${d.shop.id}`);
	});
});

describe("inbox", () => {
	it("lists issues with project, times seen and last seen", async () => {
		const d = await withData();
		const { html } = await d.page("/issues");
		expect(html).toContain("TypeError: cart is undefined");
		expect(html).toContain("RangeError: page out of range");
		expect(html).toMatch(/<td[^>]*>2<\/td>/); // times seen
		expect(html).toContain('datetime="2026-10-10T12:01:00.000Z"');
		expect(html).toContain(`href="/issues/${d.issues[0]?.id}"`);
	});

	it("filters by project, environment and text, and keeps the filter values in the form", async () => {
		const d = await withData();
		const byProject = (await d.page(`/issues?project=${d.web.id}`)).html;
		expect(byProject).toContain("RangeError");
		expect(byProject).not.toContain("TypeError: cart");
		const byEnvironment = (await d.page("/issues?environment=staging")).html;
		expect(byEnvironment).not.toContain("TypeError: cart");
		expect(byEnvironment).toMatch(/<option value="staging" selected>/);
		const bySearch = (await d.page("/issues?q=cart")).html;
		expect(bySearch).toContain("TypeError: cart");
		expect(bySearch).not.toContain("RangeError: page");
		expect(bySearch).toContain('value="cart"');
	});

	it("shows an empty state, and rejects invalid filters with 400", async () => {
		const d = await withData();
		expect((await d.page("/issues?q=nothing-matches")).html).toContain("No issues match");
		expect((await d.page("/issues?status=exploded")).response.status).toBe(400);
		expect((await d.page("/issues?cursor=%%%")).response.status).toBe(400);
	});
});

describe("issue", () => {
	it("shows title, counts, first and last seen, in-app frames with source, and tags", async () => {
		const d = await withData();
		const issue = d.issues.find((i) => i.title.startsWith("TypeError"));
		const { response, html } = await d.page(`/issues/${issue?.id}`);
		expect(response.status).toBe(200);
		expect(html).toContain("TypeError: cart is undefined");
		expect(html).toMatch(/Events<\/dt>\s*<dd>2<\/dd>/);
		expect(html).toContain("First seen");
		expect(html).toContain("/srv/app/src/checkout/total.ts");
		expect(html).toContain("return money(cart.total, list.currency);");
		expect(html).not.toContain("processTicksAndRejections"); // not in app: hidden by default
		expect(html).toContain("region");
		expect(html).toContain("us-east");
		expect(html).toContain(`href="/events/${d.events[1]?.id}"`);
	});

	it("answers 404 for an unknown or malformed issue ID", async () => {
		const d = await withData();
		expect((await d.page("/issues/999999")).response.status).toBe(404);
		expect((await d.page("/issues/abc")).response.status).toBe(404);
	});
});

describe("event", () => {
	it("shows the full event: exception, all frames, request, tags and breadcrumbs", async () => {
		const d = await withData();
		const { response, html } = await d.page(`/events/${d.events[0]?.id}`);
		expect(response.status).toBe(200);
		expect(html).toContain("TypeError");
		expect(html).toContain("processTicksAndRejections"); // all frames on the event page
		expect(html).toContain("production");
		expect(html).toContain(`href="/issues/${d.events[0]?.issue_id}"`);
	});

	it("answers 404 for an unknown event", async () => {
		const d = await withData();
		expect((await d.page("/events/424242")).response.status).toBe(404);
	});
});

describe("projects", () => {
	it("lists projects with their DSN", async () => {
		const d = await withData();
		const { html } = await d.page("/projects");
		expect(html).toContain("Shop");
		expect(html).toContain(`https://${d.shop.publicKey}@checkend.test/${d.shop.id}`);
	});

	it("creates a project and shows its DSN and Sentry.init snippets for Node and the browser", async () => {
		const d = await withData();
		const created = await d.form(
			"/projects",
			{ name: "Billing <svc>", platform: "node", _csrf: d.session.csrf },
			d.session.token,
		);
		expect(created.status).toBe(303);
		const location = created.headers.get("location") ?? "";
		expect(location).toMatch(/^\/projects\/[1-9]\d{9}$/);
		const { html } = await d.page(location);
		expect(html).toContain("Billing &lt;svc&gt;");
		expect(html).toMatch(/https:\/\/[0-9a-f]{32}@checkend\.test\/[1-9]\d{9}/);
		expect(html).toContain("@sentry/node");
		expect(html).toContain("@sentry/browser");
		expect(html).toContain("Sentry.init({");
	});

	it("rejects an empty name and keeps the form", async () => {
		const d = await withData();
		const response = await d.form(
			"/projects",
			{ name: "  ", _csrf: d.session.csrf },
			d.session.token,
		);
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("A project needs a name");
	});

	it("answers 404 for an unknown project", async () => {
		const d = await withData();
		expect((await d.page("/projects/1234567890")).response.status).toBe(404);
	});
});

describe("settings", () => {
	it("shows the health of the install, the members and a sign-out form with a CSRF token", async () => {
		const d = await withData();
		const { html } = await d.page("/settings");
		expect(html).toContain("Developer (local)");
		expect(html).toContain("0004_members_passkeys_sessions.sql");
		expect(html).toMatch(/Ingest mode<\/dt>\s*<dd>[^<]*full/);
		expect(html).toContain(`name="_csrf" value="${d.session.csrf}"`);
		expect(html).toContain('action="/logout"');
	});
});

describe("other paths", () => {
	it("sends / to the inbox", async () => {
		const d = await withData();
		const { response } = await d.page("/");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/issues");
	});

	it("serves the stylesheet and the script with long caching", async () => {
		const d = await withData();
		const { html } = await d.page("/issues");
		const css = /href="(\/assets\/app\.[0-9a-f]{8}\.css)"/.exec(html)?.[1];
		const js = /src="(\/assets\/app\.[0-9a-f]{8}\.js)"/.exec(html)?.[1];
		expect(css).toBeDefined();
		expect(js).toBeDefined();
		for (const [path, type] of [
			[css, "text/css; charset=utf-8"],
			[js, "text/javascript; charset=utf-8"],
		] as const) {
			const response = await d.request(path ?? "");
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe(type);
			expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
		}
		expect((await d.request("/assets/app.00000000.css")).status).toBe(404);
	});

	it("keeps the JSON API and ingest unchanged (no UI headers, no redirects)", async () => {
		const d = await withData();
		const api = await d.request("/v1/issues");
		expect(api.status).toBe(401);
		expect(api.headers.get("content-type")).toContain("application/json");
		expect((await d.request("/health")).status).toBe(200);
	});
});
