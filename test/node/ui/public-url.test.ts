import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfig } from "../../../src/adapters/config-env.ts";
import { DEFAULT_CONFIG } from "../../../src/ports/config.ts";
import { type CreationOptions, VirtualAuthenticator } from "../../shared/virtual-authenticator.ts";
import { UI_ADMIN_TOKEN, UI_SETUP_CODE, uiApp } from "../../support/ui.ts";

const PUBLIC = "https://errors.acme.test";
/** The Host that a proxy forwards without a check, or that an attacker sends. */
const FOREIGN = "https://evil.example";

describe("PUBLIC_URL setting", () => {
	afterEach(() => vi.restoreAllMocks());

	it("is off by default", () => {
		expect(DEFAULT_CONFIG.publicUrl).toBeNull();
		expect(readConfig({}).publicUrl).toBeNull();
		expect(readConfig({ PUBLIC_URL: "  " }).publicUrl).toBeNull();
	});

	it("keeps the origin only: scheme, host and port, in lower case", () => {
		expect(readConfig({ PUBLIC_URL: "https://Errors.Acme.test/" }).publicUrl).toBe(PUBLIC);
		expect(readConfig({ PUBLIC_URL: " http://10.0.0.5:8787 " }).publicUrl).toBe(
			"http://10.0.0.5:8787",
		);
	});

	it("is ignored, with a log line, when it is not an http(s) origin", () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		for (const value of [
			"errors.acme.test",
			"ftp://errors.acme.test",
			"https://errors.acme.test/checkend",
			"https://errors.acme.test/?a=1",
			"https://user:pass@errors.acme.test",
		]) {
			expect(readConfig({ PUBLIC_URL: value }).publicUrl, value).toBeNull();
		}
		expect(log).toHaveBeenCalledTimes(5);
		expect(String(log.mock.calls[0]?.[0])).toContain("PUBLIC_URL");
	});
});

describe("with PUBLIC_URL, a request to another Host", () => {
	const app = () => uiApp({ publicUrl: PUBLIC }, FOREIGN);

	it("uses PUBLIC_URL as the passkey relying party", async () => {
		const ui = await app();
		const setup = await ui.json(
			"/setup/options",
			{ code: UI_SETUP_CODE, name: "Simon" },
			{ origin: PUBLIC },
		);
		expect(setup.status).toBe(200);
		const options = (await setup.json()) as CreationOptions & { rp: { id: string } };
		expect(options.rp.id).toBe("errors.acme.test");
		// A passkey of PUBLIC_URL finishes the setup, although the Host is another one.
		const device = new VirtualAuthenticator(PUBLIC);
		const verify = await ui.json(
			"/setup/verify",
			{ code: UI_SETUP_CODE, response: await device.create(options) },
			{ origin: PUBLIC },
		);
		expect(verify.status).toBe(200);
		const login = await ui.json("/login/options", {}, { origin: PUBLIC });
		expect(((await login.json()) as { rpId: string }).rpId).toBe("errors.acme.test");
	});

	it("rejects a passkey made for the request Host", async () => {
		const ui = await app();
		const setup = await ui.json(
			"/setup/options",
			{ code: UI_SETUP_CODE, name: "Simon" },
			{ origin: PUBLIC },
		);
		const device = new VirtualAuthenticator(FOREIGN);
		const verify = await ui.json(
			"/setup/verify",
			{
				code: UI_SETUP_CODE,
				response: await device.create((await setup.json()) as CreationOptions),
			},
			{ origin: PUBLIC },
		);
		expect(verify.status).toBe(401);
	});

	it("checks the Origin of JSON posts and forms against PUBLIC_URL, not the Host", async () => {
		const ui = await app();
		const foreign = await ui.json(
			"/setup/options",
			{ code: UI_SETUP_CODE, name: "A" },
			{ origin: FOREIGN },
		);
		expect(foreign.status).toBe(403);
		const { token, csrf } = await ui.signIn();
		expect((await ui.form("/apps", { _csrf: csrf, name: "Shop" }, token)).status).toBe(403);
		const ok = await ui.form("/apps", { _csrf: csrf, name: "Shop" }, token, { origin: PUBLIC });
		expect(ok.status).toBe(303);
	});

	it("shows PUBLIC_URL in the setup prompt and the DSN of the UI", async () => {
		const ui = await app();
		const { token, csrf } = await ui.signIn();
		const copied = await ui.form("/apps/setup-key", { _csrf: csrf }, token, { origin: PUBLIC });
		const page = await copied.text();
		expect(page).toContain(`ce setup --url ${PUBLIC}`);
		expect(page).not.toContain("evil.example");
		const created = await ui.form("/apps", { _csrf: csrf, name: "Shop" }, token, {
			origin: PUBLIC,
		});
		const manual = await ui.request(created.headers.get("location") ?? "", { session: token });
		const html = await manual.text();
		expect(html).toMatch(/https:\/\/[0-9a-f]+@errors\.acme\.test\/\d+/);
		expect(html).not.toContain("evil.example");
		for (const path of ["/", "/apps", "/apps/new"]) {
			const text = await (await ui.request(path, { session: token })).text();
			expect(text, path).not.toContain("evil.example");
		}
	});

	it.each(["/llms.txt", "/skill.md", "/v1/openapi.json", "/agent/install", "/agent/setup.md"])(
		"uses PUBLIC_URL in %s",
		async (path) => {
			const ui = await app();
			const text = await (await ui.request(path)).text();
			expect(text).toContain("errors.acme.test");
			expect(text).not.toContain("evil.example");
		},
	);

	it("uses PUBLIC_URL in the DSNs of the API and of /v1/setup", async () => {
		const ui = await app();
		const admin = { authorization: `Bearer ${UI_ADMIN_TOKEN}`, "content-type": "application/json" };
		const post = (path: string, body: unknown, headers = admin) =>
			ui.request(path, { method: "POST", headers, body: JSON.stringify(body) });
		const created = (await (await post("/v1/projects", { name: "Shop" })).json()) as {
			data: { dsn: string };
		};
		expect(created.data.dsn).toMatch(/^https:\/\/[0-9a-f]+@errors\.acme\.test\/\d+$/);
		const listed = (await (await ui.request("/v1/projects", { headers: admin })).json()) as {
			data: { dsns: string[] }[];
		};
		expect(listed.data[0]?.dsns[0]).toMatch(/@errors\.acme\.test\//);
		const key = ((await (await post("/v1/setup/keys", {})).json()) as { data: { key: string } })
			.data.key;
		const registered = (await (
			await post(
				"/v1/setup/apps",
				{ name: "Api", platform: "node" },
				{ authorization: `Bearer ${key}`, "content-type": "application/json" },
			)
		).json()) as { data: { dsn: string } };
		expect(registered.data.dsn).toMatch(/@errors\.acme\.test\//);
	});
});

describe("without PUBLIC_URL", () => {
	it("follows the request Host, as before", async () => {
		const ui = await uiApp({}, "https://checkend.example");
		expect(await (await ui.request("/llms.txt")).text()).toContain("https://checkend.example");
		const options = await ui.json("/setup/options", { code: UI_SETUP_CODE, name: "A" });
		expect(((await options.json()) as { rp: { id: string } }).rp.id).toBe("checkend.example");
	});
});
