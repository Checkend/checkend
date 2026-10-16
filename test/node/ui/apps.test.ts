import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import { AGENT_TASKS as CORE_TASKS } from "../../../src/core/recipes.ts";
import type { Actor } from "../../../src/core/tokens.ts";
import {
	AGENT_TASKS,
	type AppProgress,
	type DeleteResult,
	type Onboarding,
	setupPrompt,
	stepsFor,
	taskPrompt,
} from "../../../src/http/ui/onboarding.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent, send } from "../../support/seed.ts";
import { UI_ORIGIN, uiApp } from "../../support/ui.ts";

const NOW = new Date("2026-10-10T12:00:00Z");

/** The page without the prompts that the copy buttons hold (text for the agent, not for people). */
const visible = (html: string) => html.replace(/data-copy-text="[^"]*"/g, "");

/** A fake of the server parts: setup keys, progress and delete. */
function fakeOnboarding() {
	const calls = { keys: [] as Actor[], deleted: [] as number[] };
	let keyNumber = 0;
	const fake: {
		calls: typeof calls;
		apps: AppProgress[];
		keysActive: number;
		deleteResult: DeleteResult;
		onboarding: Onboarding;
	} = {
		calls,
		apps: [] as AppProgress[],
		keysActive: 0,
		deleteResult: "deleted" as DeleteResult,
		onboarding: {
			createSetupKey: async (_ports, actor) => {
				calls.keys.push(actor);
				keyNumber++;
				return { key: `cks_fake${keyNumber}`, expires_at: "2026-10-10T13:00:00.000Z" };
			},
			progress: async () => ({ apps: fake.apps, setup_keys_active: fake.keysActive }),
			deleteProject: async (_ports, _actor, publicId) => {
				calls.deleted.push(publicId);
				return fake.deleteResult;
			},
		},
	};
	return fake;
}

function appProgress(
	project: { id: number; slug: string; name: string },
	done: Partial<AppProgress> = {},
): AppProgress {
	return {
		project: { ...project, platform: "node", demo: false },
		connected_at: "2026-10-10T11:00:00.000Z",
		sdk_installed_at: null,
		test_event_at: null,
		first_event_at: null,
		agent: null,
		first_deploy_at: null,
		...done,
	};
}

const COMPLETE: Partial<AppProgress> = {
	sdk_installed_at: "2026-10-10T11:01:00.000Z",
	test_event_at: "2026-10-10T11:02:00.000Z",
	agent: { name: "claude-code", at: "2026-10-10T11:03:00.000Z" },
	first_deploy_at: "2026-10-10T11:04:00.000Z",
};

async function signedIn() {
	const fake = fakeOnboarding();
	const ui = await uiApp({}, UI_ORIGIN, {}, { onboarding: fake.onboarding });
	const session = await ui.signIn();
	const page = async (path: string) => {
		const response = await ui.request(path, {
			session: session.token,
			headers: { accept: "text/html" },
		});
		return { response, html: await response.text() };
	};
	return { ...ui, fake, session, page };
}

describe("onboarding texts", () => {
	it("makes the setup prompt", () => {
		expect(setupPrompt("https://errors.acme.com", "cks_abc")).toBe(
			`Set up Checkend error tracking for this app.
1. If \`ce\` is not installed, install it: https://errors.acme.com/agent/install
2. Run \`ce setup --url https://errors.acme.com\` with the setup key in the environment variable CHECKEND_SETUP_KEY.
   Never pass the key as an argument (--key), and never write it to a file, a commit or a log.
3. Follow the steps that \`ce setup\` prints.

Setup key (valid for 1 hour): cks_abc`,
		);
	});

	it("never puts the setup key into a command line: the key is a line of data on its own", () => {
		const prompt = setupPrompt("https://errors.acme.com", "cks_abc");
		const lines = prompt.split("\n").filter((line) => line.includes("cks_abc"));
		expect(lines).toEqual(["Setup key (valid for 1 hour): cks_abc"]);
		expect(prompt).not.toMatch(/CHECKEND_SETUP_KEY=/);
		expect(prompt).not.toMatch(/--key\s+cks/);
	});

	it("names each task's recipe and command, and the app by slug and ID only", () => {
		// The tasks and commands come from the core table that also serves the recipes.
		expect(AGENT_TASKS.map((t) => [t.task, t.command])).toEqual(
			CORE_TASKS.map((t) => [t.task, t.command]),
		);
		// Each task has text for people, and that text does not use "DSN".
		for (const task of AGENT_TASKS) {
			expect(`${task.label} ${task.description}`, task.task).not.toContain("DSN");
		}
		const sourcemaps = AGENT_TASKS[0];
		if (!sourcemaps) throw new Error("no task");
		const prompt = taskPrompt(
			"https://errors.acme.com",
			{ id: 1234567890, slug: "shop" },
			sourcemaps,
		);
		expect(prompt).toContain("https://errors.acme.com/agent/tasks/sourcemaps.md");
		expect(prompt).toContain("`ce sourcemaps upload`");
		expect(prompt).toContain("shop (ID 1234567890)");
	});

	it("shows a step as done only when it happened", () => {
		const steps = stepsFor(appProgress({ id: 1, slug: "a", name: "A" }), NOW);
		expect(steps.map((s) => [s.key, s.done])).toEqual([
			["connected", true],
			["sdk", false],
			["test_event", false],
			["agent", false],
			["deploys", false],
		]);
		const done = stepsFor(appProgress({ id: 1, slug: "a", name: "A" }, COMPLETE), NOW);
		expect(done.every((s) => s.done)).toBe(true);
		expect(done.find((s) => s.key === "agent")?.detail).toBe("claude-code");
	});
});

describe("home", () => {
	it("shows the prompt box and the live checklist until every app is set up", async () => {
		const ui = await signedIn();
		const { response, html } = await ui.page("/");
		expect(response.status).toBe(200);
		expect(html).toContain("Copy prompt");
		expect(html).toContain("cks_…");
		expect(html).toContain(`${UI_ORIGIN}/agent/install`);
		expect(html).toContain("data-progress");
		expect(html).toContain("Waiting for your agent");
	});

	it("shows the dashboard when an app exists (the demo app does not count)", async () => {
		const ui = await signedIn();
		ui.fake.apps = [
			{
				...appProgress({ id: 2222222222, slug: "demo", name: "Demo" }),
				project: { id: 2222222222, slug: "demo", name: "Demo", platform: null, demo: true },
			},
		];
		expect((await ui.page("/")).html).toContain("Copy prompt");
		ui.fake.apps.push(appProgress({ id: 1111111111, slug: "shop", name: "Shop" }, COMPLETE));
		const { response, html } = await ui.page("/");
		expect(response.status).toBe(200);
		expect(html).not.toContain("Copy prompt");
		expect(html).toContain("Nothing needs you");
	});

	it("goes to the dashboard, not to the errors, when every app is set up", async () => {
		const ui = await signedIn();
		ui.fake.apps = [
			appProgress({ id: 1111111111, slug: "shop", name: "Shop" }, COMPLETE),
			{
				...appProgress({ id: 2222222222, slug: "demo", name: "Demo" }),
				project: { id: 2222222222, slug: "demo", name: "Demo", platform: null, demo: true },
			},
		];
		const { response } = await ui.page("/");
		expect(response.status).toBe(200);
	});

	it("is where the first member lands after setup", async () => {
		const ui = await uiApp();
		const html = await (await ui.request("/setup")).text();
		expect(html).toContain("data-passkey-setup");
	});
});

describe("setup key", () => {
	it("makes a new key for each copy, as the member, and returns the prompt", async () => {
		const ui = await signedIn();
		const copy = () =>
			ui.request("/apps/setup-key", {
				method: "POST",
				session: ui.session.token,
				headers: {
					origin: UI_ORIGIN,
					accept: "application/json",
					"content-type": "application/x-www-form-urlencoded",
				},
				body: new URLSearchParams({ _csrf: ui.session.csrf }).toString(),
			});
		const first = await copy();
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			prompt: setupPrompt(UI_ORIGIN, "cks_fake1"),
			expires_at: "2026-10-10T13:00:00.000Z",
		});
		const second = (await (await copy()).json()) as { prompt: string };
		expect(second.prompt).toContain("cks_fake2");
		expect(ui.fake.calls.keys.map((a: Actor) => a.type)).toEqual(["member", "member"]);
	});

	it("works without JavaScript: the page shows the prompt with the key", async () => {
		const ui = await signedIn();
		const response = await ui.form("/apps/setup-key", { _csrf: ui.session.csrf }, ui.session.token);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).toContain("Setup key (valid for 1 hour): cks_fake1");
		// The prompt names --key only to forbid it: never with a key after it.
		expect(text).not.toMatch(/--key\s+cks/);
		expect(text).not.toContain("CHECKEND_SETUP_KEY=cks");
		// A setup key makes agent tokens that read and change issues: the page must not say less.
		expect(text).not.toContain("cannot read your errors");
		expect(text).toContain("agent tokens that read and change issues");
	});

	it("needs the CSRF token", async () => {
		const ui = await signedIn();
		const response = await ui.form("/apps/setup-key", { _csrf: "wrong" }, ui.session.token);
		expect(response.status).toBe(403);
		expect(ui.fake.calls.keys).toEqual([]);
	});
});

describe("live progress", () => {
	it("returns the checklist as JSON for a member", async () => {
		const ui = await signedIn();
		ui.fake.apps = [
			appProgress(
				{ id: 1111111111, slug: "shop", name: "Shop" },
				{ test_event_at: "2026-10-10T11:59:58.000Z" },
			),
		];
		const response = await ui.request("/apps/progress", {
			session: ui.session.token,
			headers: { accept: "application/json" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		// Data, never markup: the client sets each value with textContent.
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		const body = (await response.json()) as {
			apps: { id: number; done: number; steps: { key: string; done: boolean }[] }[];
		};
		expect(body.apps[0]?.id).toBe(1111111111);
		expect(body.apps[0]?.done).toBe(2);
	});

	it("is not readable without a session", async () => {
		const ui = await signedIn();
		const response = await ui.request("/apps/progress", {
			headers: { accept: "application/json" },
		});
		expect(response.status).not.toBe(200);
	});
});

describe("apps page", () => {
	async function withApps() {
		const ui = await signedIn();
		const shop = await createProject(ui.ports, { name: "Shop <b>", platform: "node" });
		await send(ui, shop, errorEvent({ type: "TypeError", fn: "f", value: "x" }));
		ui.fake.apps = [
			appProgress(
				{ id: shop.id, slug: shop.slug, name: shop.name },
				{ test_event_at: "2026-10-10T11:00:00.000Z" },
			),
		];
		return { ...ui, shop };
	}

	it("lists each app with its setup status and an Ask your agent menu", async () => {
		const ui = await withApps();
		const { response, html } = await ui.page("/apps");
		expect(response.status).toBe(200);
		expect(html).toContain("Shop &lt;b&gt;");
		expect(html).toContain("2 of 5");
		expect(html).toContain("Ask your agent");
		for (const task of AGENT_TASKS) {
			expect(html).toContain(`/agent/tasks/${task.task}.md`);
		}
		expect(html).toContain('href="/apps/new"');
		// "DSN" only in the manual tab (the prompts for the agent can name it).
		expect(visible(html)).not.toContain("DSN");
	});

	it("moves the old Projects addresses to Apps", async () => {
		const ui = await withApps();
		const list = await ui.page("/projects");
		expect(list.response.status).toBe(301);
		expect(list.response.headers.get("location")).toBe("/apps");
		const one = await ui.page(`/projects/${ui.shop.id}`);
		expect(one.response.headers.get("location")).toBe(`/apps/${ui.shop.id}`);
	});

	it("shows the app page with the agent tasks, and the DSN only in the manual tab", async () => {
		const ui = await withApps();
		const agent = await ui.page(`/apps/${ui.shop.id}`);
		expect(agent.response.status).toBe(200);
		expect(agent.html).toContain("Manual setup");
		expect(visible(agent.html)).not.toContain("DSN");
		const manual = await ui.page(`/apps/${ui.shop.id}?tab=manual`);
		expect(manual.html).toMatch(/<abbr title="[^"]+">DSN<\/abbr>/);
		const [key] = (
			await ui.ports.db.all<{ public_key: string }>(sql`SELECT public_key FROM project_keys`)
		).map((r) => r.public_key);
		expect(manual.html).toContain(`https://${key}@checkend.test/${ui.shop.id}`);
		expect(manual.html).toContain("npm install");
	});

	it("shows the setup code for another SDK", async () => {
		const ui = await withApps();
		const { html } = await ui.page(`/apps/${ui.shop.id}?tab=manual&sdk=python`);
		expect(html).toContain("pip install");
	});

	it("creates an app by hand for people without an agent", async () => {
		const ui = await signedIn();
		const response = await ui.form(
			"/apps",
			{ _csrf: ui.session.csrf, name: "Billing", platform: "python" },
			ui.session.token,
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toMatch(/^\/apps\/[1-9]\d{9}\?tab=manual$/);
	});
});

describe("delete an app", () => {
	async function withApp() {
		const ui = await signedIn();
		const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
		ui.fake.apps = [appProgress({ id: shop.id, slug: shop.slug, name: shop.name })];
		const del = (fields: Record<string, string>, headers?: Record<string, string>) =>
			ui.form(
				`/apps/${shop.id}/delete`,
				{ _csrf: ui.session.csrf, ...fields },
				ui.session.token,
				headers,
			);
		return { ...ui, shop, del };
	}

	it("needs the app name typed to confirm", async () => {
		const ui = await withApp();
		const response = await ui.del({ confirm: "shop" });
		expect(response.status).toBe(400);
		expect(await response.text()).toContain("Type the name of the app");
		expect(ui.fake.calls.deleted).toEqual([]);
	});

	it("deletes with the right name, then shows the apps", async () => {
		const ui = await withApp();
		const response = await ui.del({ confirm: "Shop" });
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/apps?deleted=1");
		expect(ui.fake.calls.deleted).toEqual([ui.shop.id]);
		expect((await ui.page("/apps?deleted=1")).html).toContain("The app was deleted.");
	});

	it("says when an approval is necessary", async () => {
		const ui = await withApp();
		ui.fake.deleteResult = "approval_required";
		const response = await ui.del({ confirm: "Shop" });
		expect(response.status).toBe(202);
		expect(await response.text()).toContain("approval");
	});

	it("needs the CSRF token and the same origin", async () => {
		const ui = await withApp();
		expect((await ui.del({ confirm: "Shop", _csrf: "x" })).status).toBe(403);
		expect((await ui.del({ confirm: "Shop" }, { origin: "https://evil.example" })).status).toBe(
			403,
		);
		expect(ui.fake.calls.deleted).toEqual([]);
	});

	it("labels the demo app, and deletes it without a typed name", async () => {
		const ui = await withApp();
		ui.fake.apps = [
			{
				...appProgress({ id: ui.shop.id, slug: ui.shop.slug, name: ui.shop.name }),
				project: {
					id: ui.shop.id,
					slug: ui.shop.slug,
					name: ui.shop.name,
					platform: "node",
					demo: true,
				},
			},
		];
		const list = await ui.page("/apps");
		expect(list.html).toContain("Demo data");
		const one = await ui.page(`/apps/${ui.shop.id}?tab=setup`);
		expect(one.html).toContain("Delete demo");
		expect((await ui.del({ demo: "1" })).status).toBe(303);
		expect(ui.fake.calls.deleted).toEqual([ui.shop.id]);
	});
});

describe("with the core onboarding (no fake)", () => {
	it("makes a real setup key; an app that the agent registers with it shows in the progress", async () => {
		const ui = await uiApp();
		const session = await ui.signIn();
		const copied = await ui.request("/apps/setup-key", {
			method: "POST",
			session: session.token,
			headers: {
				origin: UI_ORIGIN,
				accept: "application/json",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({ _csrf: session.csrf }).toString(),
		});
		expect(copied.status).toBe(200);
		const { prompt } = (await copied.json()) as { prompt: string };
		const key = /Setup key \(valid for 1 hour\): (cks_\S+)/.exec(prompt)?.[1] ?? "";
		expect(key).not.toBe("");

		// What `ce setup` does with the key.
		const registered = await ui.request("/v1/setup/apps", {
			method: "POST",
			headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "Shop API", platform: "node" }),
		});
		expect(registered.status).toBeLessThan(300);

		const progress = await ui.request("/apps/progress", {
			session: session.token,
			headers: { accept: "application/json" },
		});
		const body = (await progress.json()) as { apps: { name: string; done: number }[] };
		expect(body.apps).toEqual([expect.objectContaining({ name: "Shop API", done: 1 })]);
	});
});

describe("delete with the core (no fake)", () => {
	it("deletes the app: it leaves the list, and its key stops working at once", async () => {
		const ui = await uiApp();
		const session = await ui.signIn();
		const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
		await send(ui, shop, errorEvent({ type: "TypeError", fn: "f", value: "x" }));
		const response = await ui.form(
			`/apps/${shop.id}/delete`,
			{ _csrf: session.csrf, confirm: "Shop" },
			session.token,
		);
		expect(response.status).toBe(303);
		const list = await ui.request("/apps", {
			session: session.token,
			headers: { accept: "text/html" },
		});
		expect(await list.text()).not.toContain(`/apps/${shop.id}"`);
		await expect(
			send(ui, shop, errorEvent({ type: "TypeError", fn: "f", value: "y" })),
		).rejects.toThrow(/ingest: 4\d\d/);
	});

	it("shows the numbers of the last 24 hours and the demo label from the core list", async () => {
		const ui = await uiApp();
		const session = await ui.signIn();
		const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
		await createProject(ui.ports, { name: "Demo", platform: "node", demo: true });
		await send(
			ui,
			shop,
			errorEvent({ type: "TypeError", fn: "f", value: "x" }),
			errorEvent({ type: "TypeError", fn: "f", value: "x" }),
		);
		const html = await (
			await ui.request("/apps", { session: session.token, headers: { accept: "text/html" } })
		).text();
		expect(html).toMatch(/data-label="Events, 24 h:">[\s\S]*?<span class="num">2</);
		expect(html).toContain("Demo data");
	});
});
