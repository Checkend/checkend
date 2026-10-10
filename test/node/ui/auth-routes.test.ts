import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTH_ATTEMPT_LIMIT } from "../../../src/core/auth/attempts.ts";
import { getSession } from "../../../src/core/auth/sessions.ts";
import { sql } from "../../../src/ports/db.ts";
import {
	type CreationOptions,
	type RequestOptions,
	VirtualAuthenticator,
} from "../../shared/virtual-authenticator.ts";
import { SESSION_COOKIE, sessionFrom, UI_ADMIN_TOKEN, uiApp } from "../../support/ui.ts";

async function setUpWithPasskey() {
	const ui = await uiApp();
	const device = new VirtualAuthenticator(ui.origin);
	const options = await ui.json("/setup/options", { token: UI_ADMIN_TOKEN, name: "Simon" });
	expect(options.status).toBe(200);
	const verify = await ui.json("/setup/verify", {
		token: UI_ADMIN_TOKEN,
		response: await device.create((await options.json()) as CreationOptions),
	});
	expect(verify.status).toBe(200);
	expect(await verify.json()).toEqual({ redirect: "/projects" });
	return { ...ui, device, setupSession: sessionFrom(verify) };
}

describe("setup over HTTP", () => {
	it("sends a new browser to /setup while no member exists", async () => {
		const ui = await uiApp();
		const response = await ui.request("/issues");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/setup");
		expect((await ui.request("/login")).headers.get("location")).toBe("/setup");
		expect((await ui.request("/setup")).status).toBe(200);
	});

	it("registers the first passkey, signs in, and closes", async () => {
		const ui = await setUpWithPasskey();
		expect(ui.setupSession).not.toBeNull();
		const page = await ui.request("/issues", { session: ui.setupSession ?? "" });
		expect(page.status).toBe(200);
		const closed = await ui.request("/setup");
		expect(closed.status).toBe(404);
		expect(await closed.text()).toContain("Setup is closed");
		const again = await ui.json("/setup/options", { token: UI_ADMIN_TOKEN, name: "Mallory" });
		expect(again.status).toBe(403);
		expect(await again.json()).toEqual({ error: "setup_closed" });
	});

	it("rejects a wrong admin token", async () => {
		const ui = await uiApp();
		const response = await ui.json("/setup/options", { token: "wrong", name: "A" });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "invalid_token" });
	});
});

describe("sign-in over HTTP", () => {
	it("signs in with a passkey and sets a strict session cookie", async () => {
		const ui = await setUpWithPasskey();
		const login = await ui.request("/login");
		expect(login.status).toBe(200);
		const options = await ui.json("/login/options", {});
		expect(options.status).toBe(200);
		const verify = await ui.json("/login/verify", {
			response: await ui.device.get((await options.json()) as RequestOptions),
		});
		expect(verify.status).toBe(200);
		expect(await verify.json()).toEqual({ redirect: "/issues" });
		const cookie = verify.headers.get("set-cookie") ?? "";
		expect(cookie).toMatch(
			new RegExp(
				`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; Max-Age=1209600; HttpOnly; Secure; SameSite=Strict$`,
			),
		);
	});

	it("answers 401 for a failed passkey", async () => {
		const ui = await setUpWithPasskey();
		const stranger = new VirtualAuthenticator(ui.origin);
		const options = await ui.json("/login/options", {});
		const verify = await ui.json("/login/verify", {
			response: await stranger.get((await options.json()) as RequestOptions),
		});
		expect(verify.status).toBe(401);
		expect(verify.headers.get("set-cookie")).toBeNull();
	});

	it("limits sign-in attempts per client", async () => {
		const ui = await setUpWithPasskey();
		const headers = { origin: ui.origin, "cf-connecting-ip": "203.0.113.9" };
		for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i++) {
			expect((await ui.json("/login/options", {}, headers)).status).toBe(200);
		}
		const limited = await ui.json("/login/options", {}, headers);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("retry-after")).toBe("900");
	});

	it("rejects JSON posts from another origin, without an origin, or as a form", async () => {
		const ui = await setUpWithPasskey();
		expect((await ui.json("/login/options", {}, { origin: "https://evil.example" })).status).toBe(
			403,
		);
		expect((await ui.json("/login/options", {}, {})).status).toBe(403);
		const asForm = await ui.request("/login/options", {
			method: "POST",
			headers: { origin: ui.origin, "content-type": "text/plain" },
			body: "{}",
		});
		expect(asForm.status).toBe(415);
	});

	it("signs out: deletes the session and clears the cookie", async () => {
		const ui = await uiApp();
		const { token, csrf } = await ui.signIn();
		const response = await ui.form("/logout", { _csrf: csrf }, token);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/login");
		expect(response.headers.get("set-cookie")).toBe(
			`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
		);
		expect(await getSession(ui.ports, token)).toBeNull();
	});
});

describe("client key for the rate limit", () => {
	it("uses the /64 network for IPv6, so one network cannot rotate addresses", async () => {
		const { clientKey } = await import("../../../src/http/ui/security.ts");
		expect(clientKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
		expect(clientKey("2001:db8:1:2::9")).toBe("2001:db8:1:2::/64");
		expect(clientKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
		expect(clientKey("203.0.113.7")).toBe("203.0.113.7");
		expect(clientKey(undefined)).toBe("unknown");
	});
});

describe("CSRF", () => {
	it("rejects a form post without, or with a wrong, CSRF token", async () => {
		const ui = await uiApp();
		const { token } = await ui.signIn();
		expect((await ui.form("/logout", {}, token)).status).toBe(403);
		expect((await ui.form("/logout", { _csrf: "x".repeat(43) }, token)).status).toBe(403);
		expect((await ui.form("/projects", { name: "New" }, token)).status).toBe(403);
		expect(await ui.ports.db.all(sql`SELECT id FROM projects`)).toEqual([]);
	});

	it("rejects a form post from another origin, even with the right token", async () => {
		const ui = await uiApp();
		const { token, csrf } = await ui.signIn();
		const crossSite = await ui.form("/projects", { name: "New", _csrf: csrf }, token, {
			origin: "https://evil.example",
		});
		expect(crossSite.status).toBe(403);
		const fetchSite = await ui.form("/projects", { name: "New", _csrf: csrf }, token, {
			origin: ui.origin,
			"sec-fetch-site": "cross-site",
		});
		expect(fetchSite.status).toBe(403);
		expect(await ui.ports.db.all(sql`SELECT id FROM projects`)).toEqual([]);
	});

	it("rejects a form post without a session", async () => {
		const ui = await uiApp();
		await ui.signIn();
		const response = await ui.form("/projects", { name: "New", _csrf: "x" });
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/login");
	});
});

describe("development login", () => {
	it("is off by default", async () => {
		const ui = await uiApp({}, "http://localhost:8787");
		expect((await ui.request("/dev/login")).status).toBe(404);
	});

	it("works with the development flag on localhost", async () => {
		const ui = await uiApp({ devMode: true }, "http://localhost:8787");
		const response = await ui.request("/dev/login");
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/issues");
		expect(sessionFrom(response)).not.toBeNull();
	});

	it("refuses a request that came through a proxy or tunnel, even with a local Host", async () => {
		const ui = await uiApp({ devMode: true }, "http://localhost:8787");
		for (const headers of [
			{ "cf-connecting-ip": "203.0.113.5" },
			{ "x-forwarded-for": "203.0.113.5" },
			{ "x-forwarded-host": "dev.example.com" },
			{ forwarded: "for=203.0.113.5" },
		]) {
			expect((await ui.request("/dev/login", { headers })).status, JSON.stringify(headers)).toBe(
				404,
			);
		}
		const local = await ui.request("/dev/login", { headers: { "cf-connecting-ip": "127.0.0.1" } });
		expect(local.status).toBe(303);
	});

	it("refuses a host that is not local, even with the flag", async () => {
		const ui = await uiApp({ devMode: true }, "https://checkend.example");
		expect((await ui.request("/dev/login")).status).toBe(404);
	});

	it("is off in the production configuration", () => {
		// readConfig() is tested in test/workers/cloudflare-ports.test.ts.
		// The committed Worker config must never turn it on; only `npm run dev` passes it.
		const wrangler = readFileSync("wrangler.jsonc", "utf8");
		expect(wrangler).not.toContain("CHECKEND_DEV");
		const pkg = JSON.parse(readFileSync("package.json", "utf8"));
		expect(pkg.scripts.deploy).not.toContain("CHECKEND_DEV");
		expect(pkg.scripts["deploy:production"]).not.toContain("CHECKEND_DEV");
	});
});

describe("session cookie", () => {
	it("ignores an unknown session and sends the browser to sign in", async () => {
		const ui = await uiApp();
		await ui.signIn();
		const response = await ui.request("/issues", { session: "a".repeat(43) });
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/login");
	});
});
