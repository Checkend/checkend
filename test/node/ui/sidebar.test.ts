import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import type { AppProgress, Onboarding } from "../../../src/http/ui/onboarding.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { UI_ORIGIN, uiApp } from "../../support/ui.ts";

const app = (done: Partial<AppProgress> = {}): AppProgress => ({
	project: { id: 1111111111, slug: "shop", name: "Shop", platform: "node", demo: false },
	connected_at: "2026-10-10T11:00:00.000Z",
	sdk_installed_at: null,
	test_event_at: null,
	first_event_at: null,
	agent: null,
	first_deploy_at: null,
	...done,
});

const COMPLETE: Partial<AppProgress> = {
	sdk_installed_at: "2026-10-10T11:01:00.000Z",
	test_event_at: "2026-10-10T11:02:00.000Z",
	agent: { name: "claude-code", at: "2026-10-10T11:03:00.000Z" },
	first_deploy_at: "2026-10-10T11:04:00.000Z",
};

async function withSidebar(apps: AppProgress[], config = {}, origin = UI_ORIGIN) {
	const onboarding: Onboarding = {
		createSetupKey: async () => null,
		progress: async () => ({ apps, setup_keys_active: 0 }),
		deleteProject: async () => "unavailable",
	};
	const ui = await uiApp(config, origin, {}, { onboarding });
	const session = await ui.signIn();
	const page = async (path: string) =>
		(await ui.request(path, { session: session.token, headers: { accept: "text/html" } })).text();
	return { ...ui, session, page };
}

const sidebarOf = (html: string) => /<aside class="side"[\s\S]*?<\/aside>/.exec(html)?.[0] ?? "";

describe("sidebar", () => {
	it("replaces the top bar: primary links, the current page, and account items at the bottom", async () => {
		const ui = await withSidebar([app(COMPLETE)]);
		const html = await ui.page("/apps");
		expect(html).not.toContain('class="top"');
		const side = sidebarOf(html);
		expect(side).toContain('<nav class="side-nav" aria-label="Primary"');
		expect(side).not.toContain('href="/issues"');
		expect(side).toMatch(/href="\/"[^>]*>[\s\S]*?Dashboard/);
		for (const href of ["/", "/apps", "/settings"]) {
			expect(side).toContain(`href="${href}"`);
		}
		expect(side).toMatch(/href="\/apps"[^>]*aria-current="page"/);
		expect(side).toContain("Developer (local)");
		expect(side).toContain('action="/logout"');
		expect(side).toContain(`name="_csrf" value="${ui.session.csrf}"`);
		expect(side).toContain("Docs");
	});

	it("shows the setup progress on Home until every app is set up", async () => {
		const incomplete = await withSidebar([app({ test_event_at: "2026-10-10T11:02:00.000Z" })]);
		expect(sidebarOf(await incomplete.page("/apps"))).toContain("Setup 2/5");
		const none = await withSidebar([]);
		expect(sidebarOf(await none.page("/apps"))).toContain("Start");
		const done = await withSidebar([app(COMPLETE)]);
		expect(sidebarOf(await done.page("/apps"))).not.toMatch(/Setup \d\/5|Start/);
	});

	it("counts the new unresolved issues (first seen in the last 24 hours) on Issues", async () => {
		const ui = await withSidebar([app(COMPLETE)]);
		const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
		await send(
			ui,
			shop,
			errorEvent({ type: "TypeError", fn: "a", value: "x" }),
			errorEvent({ type: "RangeError", fn: "b", value: "y" }),
		);
		const side = sidebarOf(await ui.page("/settings"));
		expect(side).toMatch(/<span class="badge"[^>]*>2<\/span>/);
		expect(side).toContain("2 new");
	});

	it("shows the development flag only in development mode", async () => {
		const prod = await withSidebar([app(COMPLETE)]);
		expect(sidebarOf(await prod.page("/apps"))).not.toContain("Development");
		const dev = await withSidebar([app(COMPLETE)], { devMode: true }, "http://localhost:8787");
		expect(sidebarOf(await dev.page("/apps"))).toContain("Development");
	});

	it("has a menu button for phones that the script shows", async () => {
		const ui = await withSidebar([app(COMPLETE)]);
		const side = sidebarOf(await ui.page("/apps"));
		expect(side).toMatch(
			/<button class="side-toggle"[^>]*aria-controls="side-nav"[^>]*aria-expanded="false"[^>]*data-js-only hidden/,
		);
	});

	it("is not on the sign-in and setup pages", async () => {
		const ui = await uiApp();
		expect(await (await ui.request("/setup")).text()).not.toContain('class="side"');
	});
});
