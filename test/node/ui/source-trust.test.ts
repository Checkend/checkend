import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { uiApp } from "../../support/ui.ts";

const server = (value: string) => ({
	...errorEvent({ type: "TypeError", fn: "f", value }),
	sdk: { name: "sentry.javascript.node", version: "8.0.0" },
});
const browser = (value: string) => ({
	...errorEvent({ type: "TypeError", fn: "g", value }),
	sdk: { name: "sentry.javascript.react", version: "8.0.0" },
});

async function setup() {
	const ui = await uiApp();
	const session = await ui.signIn();
	const page = async (path: string) =>
		(await ui.request(path, { session: session.token, headers: { accept: "text/html" } })).text();
	const api = await createProject(ui.ports, { name: "Api", platform: "node" });
	const web = await createProject(ui.ports, { name: "Web", platform: "javascript" });
	const both = await createProject(ui.ports, { name: "Both", platform: "node" });
	const empty = await createProject(ui.ports, { name: "Empty", platform: "node" });
	await send(ui, api, server("a"));
	await send(ui, web, browser("b"));
	await send(ui, both, server("c"), browser("d"));
	return { ...ui, page, api, web, both, empty };
}

describe("source trust in the UI", () => {
	it("the apps list shows the source and the trust of each app", async () => {
		const ui = await setup();
		const html = await ui.page("/apps");
		const rowOf = (name: string) => new RegExp(`>${name}</a>[\\s\\S]*?</tr>`).exec(html)?.[0] ?? "";
		expect(rowOf("Api")).toContain(
			'<span class="trust trust-high" data-trust="high">Server SDK · High trust</span>',
		);
		expect(rowOf("Web")).toContain(
			'<span class="trust trust-low" data-trust="low">Browser · Low trust</span>',
		);
		expect(rowOf("Both")).toContain('data-trust="low">Mixed · Low trust</span>');
		expect(rowOf("Empty")).toContain('data-trust="none">No events yet</span>');
	});

	it("the app page of a low-trust app says how to improve it and how to get alerts again", async () => {
		const ui = await setup();
		const web = await ui.page(`/apps/${ui.web.id}`);
		expect(web).toContain("Browser · Low trust");
		expect(web).toContain("data-trust-note");
		expect(web).toContain("Send browser events to a separate app.");
		expect(web).toContain("Report important errors from a server SDK.");
		expect(web).toContain("set the trust of this app to high");
		expect(web).toContain("set the minimum trust of an alert to low");
		const api = await ui.page(`/apps/${ui.api.id}`);
		expect(api).toContain("Server SDK · High trust");
		expect(api).not.toContain("data-trust-note");
	});

	it("a marked key keeps the app low after 30 quiet days; a new key makes it high", async () => {
		const ui = await setup();
		// The browser event is 31 days old (the session would not last a clock jump).
		await ui.ports.db.run(
			sql`UPDATE projects SET client_seen_at = ${new Date(ui.clock.now().getTime() - 31 * 86_400_000).toISOString()}
				WHERE id = ${ui.web.internalId}`,
		);
		await send(ui, ui.web, server("e"));
		const before = await ui.page(`/apps/${ui.web.id}`);
		expect(before).toContain("Server SDK · Low trust</span>");
		expect(before).toContain("The app stays low trust, also when these events stop");
		expect(before).toContain("make a new app key");
		await ui.ports.db.run(
			sql`UPDATE project_keys SET revoked_at = ${ui.clock.now().toISOString()}
				WHERE project_id = ${ui.web.internalId}`,
		);
		await ui.ports.db.run(
			sql`INSERT INTO project_keys (project_id, public_key, created_at)
				VALUES (${ui.web.internalId}, ${"f".repeat(32)}, ${ui.clock.now().toISOString()})`,
		);
		const after = await ui.page(`/apps/${ui.web.id}`);
		expect(after).toContain("Server SDK · High trust</span>");
		expect(after).not.toContain("data-trust-note");
	});

	it("an admin setting shows as set by hand", async () => {
		const ui = await setup();
		await ui.ports.db.run(sql`UPDATE projects SET trust = 'high' WHERE name = 'Web'`);
		const web = await ui.page(`/apps/${ui.web.id}`);
		expect(web).toContain("Browser · High trust (set by hand)");
		expect(web).not.toContain("data-trust-note");
	});

	it("the issue page names the source of its app, and never the raw SDK name there", async () => {
		const ui = await setup();
		const issue = await ui.ports.db.first<{ id: number }>(
			sql`SELECT i.id FROM issues i JOIN projects p ON p.id = i.project_id WHERE p.name = 'Web'`,
		);
		const html = await ui.page(`/issues/${issue?.id}`);
		expect(html).toMatch(/<dt>Source<\/dt>\s*<dd>Browser · Low trust<\/dd>/);
		const facts = /<dl class="facts">[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "";
		expect(facts).not.toContain("sentry.javascript.react");
	});
});
