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
import {
	SESSION_COOKIE,
	sessionFrom,
	UI_ADMIN_TOKEN,
	UI_ORIGIN,
	UI_SETUP_CODE,
	uiApp,
} from "../../support/ui.ts";

async function setUpWithPasskey(
	ui?: Awaited<ReturnType<typeof uiApp>>,
	code: unknown = UI_SETUP_CODE,
) {
	const app = ui ?? (await uiApp());
	const device = new VirtualAuthenticator(app.origin);
	const options = await app.json("/setup/options", { code, name: "Simon" });
	expect(options.status).toBe(200);
	const verify = await app.json("/setup/verify", {
		code,
		response: await device.create((await options.json()) as CreationOptions),
	});
	expect(verify.status).toBe(200);
	expect(await verify.json()).toEqual({ redirect: "/" });
	return { ...app, device, setupSession: sessionFrom(verify) };
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

	it("registers the first passkey with the setup code, signs in, and closes", async () => {
		const ui = await setUpWithPasskey();
		expect(ui.setupSession).not.toBeNull();
		const page = await ui.request("/issues", { session: ui.setupSession ?? "" });
		expect(page.status).toBe(200);
		const closed = await ui.request("/setup");
		expect(closed.status).toBe(404);
		expect(await closed.text()).toContain("Setup is closed");
		// The code works once: when a member exists, it does nothing.
		const again = await ui.json("/setup/options", { code: UI_SETUP_CODE, name: "Mallory" });
		expect(again.status).toBe(403);
		expect(await again.json()).toEqual({ error: "setup_closed" });
	});

	it("rejects a wrong or missing setup code, and the ADMIN_TOKEN", async () => {
		const ui = await uiApp();
		for (const body of [
			{ code: "wrong", name: "A" },
			{ name: "A" },
			{ code: UI_ADMIN_TOKEN, name: "A" },
			{ token: UI_ADMIN_TOKEN, name: "A" },
		]) {
			const response = await ui.json("/setup/options", body);
			expect(response.status, JSON.stringify(body)).toBe(403);
			expect(await response.json()).toEqual({ error: "invalid_code" });
		}
	});

	it("takes the code from the body only, never from the URL", async () => {
		const ui = await uiApp();
		const response = await ui.json(`/setup/options?code=${UI_SETUP_CODE}`, { name: "A" });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "invalid_code" });
	});

	it("limits setup attempts per client", async () => {
		const ui = await uiApp();
		const headers = { origin: ui.origin, "cf-connecting-ip": "203.0.113.7" };
		for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i++) {
			expect((await ui.json("/setup/options", { code: "x", name: "A" }, headers)).status).toBe(403);
		}
		const limited = await ui.json("/setup/options", { code: UI_SETUP_CODE, name: "A" }, headers);
		expect(limited.status).toBe(429);
	});

	it("shows a name field and no secret field; the code comes from the link", async () => {
		const ui = await uiApp();
		const html = await (await ui.request("/setup")).text();
		expect(html).toContain('name="name"');
		expect(html).not.toContain('type="password"');
		expect(html).not.toContain("ADMIN_TOKEN");
		expect(html).toContain("data-needs-code");
		expect(html).toContain("Open the setup link from your deploy output");
		expect(html).toContain("npm run setup-link");
		expect(html).toContain("https://github.com/Checkend/checkend/blob/main/guides/web-ui.md");
	});

	it("says that the setup link expired after 24 hours", async () => {
		const ui = await uiApp();
		ui.clock.advance(24 * 3_600_000 + 1000);
		const html = await (await ui.request("/setup")).text();
		expect(html).not.toContain("data-passkey-setup");
		expect(html).toContain(
			"This setup link has expired. Run <code>npm run setup-link</code> for a new one.",
		);
		const response = await ui.json("/setup/options", { code: UI_SETUP_CODE, name: "A" });
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "setup_expired" });
	});

	it("shows only the notice when SETUP_CODE is not set", async () => {
		const ui = await uiApp({ setupCode: null });
		const html = await (await ui.request("/setup")).text();
		expect(html).not.toContain("data-passkey-setup");
		expect(html).toContain("This install is not set up yet.");
	});
});

describe("setup in development mode", () => {
	it("needs no code on localhost", async () => {
		const ui = await uiApp({ devMode: true, setupCode: null }, "http://localhost:8787");
		const html = await (await ui.request("/setup")).text();
		expect(html).toContain("data-passkey-setup");
		expect(html).not.toContain("data-needs-code");
		await setUpWithPasskey(ui, undefined);
	});

	it("needs the code through a proxy, on another host, or without the flag", async () => {
		const cases = [
			{
				config: { devMode: true },
				origin: "http://localhost:8787",
				headers: { "x-forwarded-for": "203.0.113.5" },
			},
			{
				config: { devMode: true },
				origin: "http://localhost:8787",
				headers: { "cf-connecting-ip": "203.0.113.5" },
			},
			{ config: { devMode: true }, origin: "https://checkend.example", headers: {} },
			{ config: {}, origin: "http://localhost:8787", headers: {} },
		];
		for (const { config, origin, headers } of cases) {
			const ui = await uiApp(config, origin);
			const response = await ui.json("/setup/options", { name: "A" }, { origin, ...headers });
			expect(response.status, JSON.stringify({ origin, headers })).toBe(403);
			expect(await response.json()).toEqual({ error: "invalid_code" });
		}
	});
});

describe("sign-in page", () => {
	it("tells a person without a passkey to ask the admin", async () => {
		const ui = await setUpWithPasskey();
		const html = await (await ui.request("/login")).text();
		expect(html).toContain("No passkey for this install? Ask the admin to add you.");
		expect(html).not.toContain('href="/dev/login"');
	});

	it("links to the development login in development mode only", async () => {
		const ui = await setUpWithPasskey(await uiApp({ devMode: true }, "http://localhost:8787"));
		expect(await (await ui.request("/login")).text()).toContain('href="/dev/login"');
		const proxied = await ui.request("/login", { headers: { "x-forwarded-for": "203.0.113.5" } });
		expect(await proxied.text()).not.toContain('href="/dev/login"');
	});
});

describe("GET /health", () => {
	it("says whether setup is open", async () => {
		const ui = await uiApp();
		expect(await (await ui.request("/health")).json()).toMatchObject({ setup_open: true });
		await setUpWithPasskey(ui);
		expect(await (await ui.request("/health")).json()).toMatchObject({ setup_open: false });
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
		expect((await ui.form("/apps", { name: "New" }, token)).status).toBe(403);
		expect(await ui.ports.db.all(sql`SELECT id FROM projects`)).toEqual([]);
	});

	it("rejects a form post from another origin, even with the right token", async () => {
		const ui = await uiApp();
		const { token, csrf } = await ui.signIn();
		const crossSite = await ui.form("/apps", { name: "New", _csrf: csrf }, token, {
			origin: "https://evil.example",
		});
		expect(crossSite.status).toBe(403);
		const fetchSite = await ui.form("/apps", { name: "New", _csrf: csrf }, token, {
			origin: ui.origin,
			"sec-fetch-site": "cross-site",
		});
		expect(fetchSite.status).toBe(403);
		expect(await ui.ports.db.all(sql`SELECT id FROM projects`)).toEqual([]);
	});

	it("rejects a form post without a session", async () => {
		const ui = await uiApp();
		await ui.signIn();
		const response = await ui.form("/apps", { name: "New", _csrf: "x" });
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

describe("client address from the clientIp port (the Node server)", () => {
	// On Node, ports.clientIp gives the socket address; a client can send any header.
	const remote = { clientIp: () => "203.0.113.5" };

	it("limits sign-in by the port's address, not by a header that the client sends", async () => {
		const ui = await uiApp({}, UI_ORIGIN, remote);
		for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i++) {
			const headers = { origin: ui.origin, "cf-connecting-ip": `198.51.100.${i}` };
			expect((await ui.json("/login/options", {}, headers)).status).toBe(200);
		}
		const headers = { origin: ui.origin, "cf-connecting-ip": "198.51.100.200" };
		expect((await ui.json("/login/options", {}, headers)).status).toBe(429);
	});

	it("refuses development mode for a remote socket, even with a localhost Host header", async () => {
		const ui = await uiApp({ devMode: true, setupCode: null }, "http://localhost:8787", remote);
		expect((await ui.request("/dev/login")).status).toBe(404);
		const setup = await ui.json("/setup/options", { name: "A" });
		expect(await setup.json()).toEqual({ error: "invalid_code" });
	});

	it("allows development mode for a loopback socket", async () => {
		for (const ip of ["127.0.0.1", "::1"]) {
			const ui = await uiApp({ devMode: true }, "http://localhost:8787", { clientIp: () => ip });
			expect((await ui.request("/dev/login")).status, ip).toBe(303);
		}
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
