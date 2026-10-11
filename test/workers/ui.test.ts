import { applyD1Migrations, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CSP } from "../../src/http/ui/security.ts";
import {
	type CreationOptions,
	type RequestOptions,
	VirtualAuthenticator,
} from "../shared/virtual-authenticator.ts";

const ORIGIN = "https://checkend.test";

const post = (path: string, body: unknown, cookie?: string) =>
	exports.default.fetch(
		new Request(`${ORIGIN}${path}`, {
			method: "POST",
			headers: {
				origin: ORIGIN,
				"content-type": "application/json",
				...(cookie ? { cookie } : {}),
			},
			body: JSON.stringify(body),
		}),
	);

const get = (path: string, cookie?: string) =>
	exports.default.fetch(
		new Request(`${ORIGIN}${path}`, {
			redirect: "manual",
			headers: { accept: "text/html", ...(cookie ? { cookie } : {}) },
		}),
	);

const cookieOf = (response: Response) =>
	(response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
});

describe("web UI in the Worker (D1)", () => {
	it("sets up with a passkey, signs in, and shows the pages with a strict CSP", async () => {
		const first = await get("/issues");
		expect(first.status, await first.clone().text()).toBe(303);
		expect(first.headers.get("location")).toBe("/setup");
		const device = new VirtualAuthenticator(ORIGIN);
		const options = await post("/setup/options", { code: env.SETUP_CODE, name: "Simon" });
		expect(options.status).toBe(200);
		const setup = await post("/setup/verify", {
			code: env.SETUP_CODE,
			response: await device.create((await options.json()) as CreationOptions),
		});
		expect(setup.status).toBe(200);

		const signInOptions = await post("/login/options", {});
		const signIn = await post("/login/verify", {
			response: await device.get((await signInOptions.json()) as RequestOptions),
		});
		expect(signIn.status).toBe(200);
		const cookie = cookieOf(signIn);
		expect(cookie).toMatch(/^__Host-checkend_session=/);

		for (const path of ["/issues", "/apps", "/settings"]) {
			const page = await get(path, cookie);
			expect(page.status, path).toBe(200);
			expect(page.headers.get("content-security-policy"), path).toBe(CSP);
			expect(await page.text(), path).toContain("Simon");
		}
	});

	it("has no development login in the Worker built from wrangler.jsonc", async () => {
		const response = await exports.default.fetch(
			new Request("http://localhost:8787/dev/login", { redirect: "manual" }),
		);
		expect(response.status).toBe(404);
		expect(response.headers.get("set-cookie")).toBeNull();
	});
});
