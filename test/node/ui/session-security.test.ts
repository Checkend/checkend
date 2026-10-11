import { describe, expect, it } from "vitest";
import { getSession } from "../../../src/core/auth/sessions.ts";
import { createProject } from "../../../src/core/projects.ts";
import {
	type CreationOptions,
	type RequestOptions,
	VirtualAuthenticator,
} from "../../shared/virtual-authenticator.ts";
import { SESSION_COOKIE, sessionFrom, UI_SETUP_CODE, uiApp } from "../../support/ui.ts";

const STRICT_COOKIE = new RegExp(
	`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Strict$`,
);

/** A session ID that an attacker chose and planted in the victim's browser. */
const PLANTED = "a".repeat(43);

async function setUp() {
	const ui = await uiApp();
	const device = new VirtualAuthenticator(ui.origin);
	const planted = { origin: ui.origin, cookie: `${SESSION_COOKIE}=${PLANTED}` };
	const options = await ui.json("/setup/options", { code: UI_SETUP_CODE, name: "Simon" }, planted);
	const verify = await ui.json(
		"/setup/verify",
		{
			code: UI_SETUP_CODE,
			response: await device.create((await options.json()) as CreationOptions),
		},
		planted,
	);
	return { ...ui, device, planted, setup: verify };
}

describe("session fixation", () => {
	it("setup sets a new, strict session cookie, never the ID that the browser sent", async () => {
		const ui = await setUp();
		expect(ui.setup.status).toBe(200);
		expect(ui.setup.headers.get("set-cookie")).toMatch(STRICT_COOKIE);
		expect(sessionFrom(ui.setup)).not.toBe(PLANTED);
		expect(await getSession(ui.ports, PLANTED)).toBeNull();
	});

	it("sign-in sets a new session ID each time, never the ID that the browser sent", async () => {
		const ui = await setUp();
		const signIn = async () => {
			const options = await ui.json("/login/options", {}, ui.planted);
			return ui.json(
				"/login/verify",
				{ response: await ui.device.get((await options.json()) as RequestOptions) },
				ui.planted,
			);
		};
		const first = await signIn();
		const second = await signIn();
		expect(first.headers.get("set-cookie")).toMatch(STRICT_COOKIE);
		const ids = [sessionFrom(ui.setup), sessionFrom(first), sessionFrom(second)];
		expect(new Set(ids).size).toBe(3);
		expect(ids).not.toContain(PLANTED);
		expect(await getSession(ui.ports, PLANTED)).toBeNull();
	});
});

describe("the API and MCP never accept the session cookie", () => {
	it("answers 401 on /v1 and /mcp to a valid session cookie without a bearer token", async () => {
		const ui = await uiApp();
		const { token } = await ui.signIn();
		const cookie = { cookie: `${SESSION_COOKIE}=${token}`, origin: ui.origin };
		for (const [method, path] of [
			["GET", "/v1/issues"],
			["GET", "/v1/projects"],
			["POST", "/v1/projects"],
			["GET", "/mcp"],
			["POST", "/mcp"],
		] as const) {
			const response = await ui.request(path, {
				method,
				headers: { ...cookie, "content-type": "application/json" },
				...(method === "POST" ? { body: "{}" } : {}),
			});
			expect(response.status, `${method} ${path}`).toBe(401);
		}
	});
});

describe("every state-changing UI route", () => {
	it("refuses a request from another origin, even with a valid session and CSRF token", async () => {
		const ui = await uiApp();
		const { token, csrf } = await ui.signIn();
		const app = await createProject(ui.ports, { name: "Shop", platform: "node" });
		const routes = ui.app.routes.filter(
			(r) =>
				["POST", "PUT", "PATCH", "DELETE"].includes(r.method) &&
				// Not UI: bearer tokens (/v1, /mcp), DSN keys (/api), signed webhooks (/hooks).
				!/^\/(v1|api|mcp|hooks)(\/|$)/.test(r.path),
		);
		// The list must find the UI routes; a new one is checked here without a change.
		expect(routes.map((r) => r.path)).toEqual(
			expect.arrayContaining([
				"/login/options",
				"/setup/verify",
				"/logout",
				"/apps",
				"/apps/:id/delete",
			]),
		);
		for (const route of routes) {
			const path = route.path.replace(":id", String(app.id));
			const form = await ui.form(path, { _csrf: csrf, confirm: "Shop" }, token, {
				origin: "https://evil.example",
			});
			// 403: refused by the origin or CSRF check; 415: a JSON route refuses a form first.
			expect([403, 415], `${route.method} ${path} (form)`).toContain(form.status);
			const json = await ui.json(
				path,
				{},
				{
					origin: "https://evil.example",
					cookie: `${SESSION_COOKIE}=${token}`,
				},
			);
			expect([403, 415], `${route.method} ${path} (JSON)`).toContain(json.status);
		}
		// Nothing changed: the app still exists.
		expect((await ui.request(`/apps/${app.id}`, { session: token })).status).toBe(200);
	});
});

describe("CORS", () => {
	it("sends no CORS headers on UI routes, also to a request from another origin", async () => {
		const ui = await uiApp();
		const { token } = await ui.signIn();
		const evil = { origin: "https://evil.example" };
		const responses = [
			...(await Promise.all(
				["/", "/issues", "/apps", "/settings", "/apps/progress", "/login", "/setup"].map((path) =>
					ui.request(path, { session: token, headers: evil }),
				),
			)),
			await ui.json("/login/options", {}, evil),
			await ui.request("/apps/setup-key", {
				method: "OPTIONS",
				headers: { ...evil, "access-control-request-method": "POST" },
			}),
		];
		for (const response of responses) {
			for (const [name] of response.headers) {
				expect(name.toLowerCase(), response.url).not.toMatch(/^access-control-/);
			}
		}
	});
});
