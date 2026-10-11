import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { FrontIdentity } from "../../src/core/auth/front-identity.ts";

/**
 * A hosted install as the front Worker uses it: provisioned once with its base path, then called
 * with `serve(request, identity)`. The identity is an argument of the call, never a header.
 */
const ORIGIN = "https://hosted.test";
const ALICE: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };
const install = (name: string) => env.INSTALL.get(env.INSTALL.idFromName(name));

async function provisioned(name: string, id: string) {
	const stub = install(name);
	expect(
		await stub.provision({ basePath: `/${id}`, publicUrl: ORIGIN, spacesUrl: `${ORIGIN}/spaces` }),
	).toEqual({ ok: true });
	return stub;
}

describe("a provisioned hosted install", () => {
	it("serves the UI under its base path to the identity of the call", async () => {
		const stub = await provisioned("hosted-ui", "k7q2x9");
		const page = await stub.serve(new Request(`${ORIGIN}/k7q2x9/apps/new`), ALICE);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain('href="/k7q2x9/issues"');
		expect(html).toContain(`href="${ORIGIN}/spaces"`);
		expect(html).toContain(`ce setup --url ${ORIGIN}/k7q2x9`);
	});

	it("refuses UI routes without an identity, also with stub.fetch and a cookie", async () => {
		const stub = await provisioned("hosted-anon", "a2b3c4");
		expect((await stub.serve(new Request(`${ORIGIN}/a2b3c4/issues`), null)).status).toBe(404);
		const fetched = await stub.fetch(`${ORIGIN}/a2b3c4/issues`, {
			headers: { cookie: "__Host-checkend_session=x" },
		});
		expect(fetched.status).toBe(404);
	});

	it("does not open setup with the shared SETUP_CODE of the Worker", async () => {
		const stub = await provisioned("hosted-setup", "s3t4u5");
		const code = env.TEST_SETUP_CODE;
		for (const path of ["/setup", "/login"]) {
			expect((await stub.fetch(`${ORIGIN}/s3t4u5${path}`)).status, path).toBe(404);
		}
		const options = await stub.fetch(`${ORIGIN}/s3t4u5/setup/options`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN },
			body: JSON.stringify({ code, name: "Mallory" }),
		});
		expect(options.status).toBe(404);
	});

	it("takes no shared secret or development flag from the Worker environment", async () => {
		const stub = await provisioned("hosted-config", "c6d7e8");
		const config = await runInDurableObject(stub, async (instance) => instance.config());
		expect(config).toMatchObject({
			adminToken: null,
			setupCode: null,
			githubWebhookSecret: null,
			githubToken: null,
			devMode: false,
			trustedFront: true,
			basePath: "/c6d7e8",
			publicUrl: ORIGIN,
			spacesUrl: `${ORIGIN}/spaces`,
		});
	});

	it("answers only under its base path", async () => {
		const stub = await provisioned("hosted-paths", "p9q8r7");
		for (const path of ["/health", "/other/health", "/p9q8r7x/health"]) {
			expect((await stub.fetch(`${ORIGIN}${path}`)).status, path).toBe(404);
		}
		expect((await stub.fetch(`${ORIGIN}/p9q8r7/health`)).status).toBe(200);
	});

	it("keeps its base path: a second provision with another one is refused", async () => {
		const stub = await provisioned("hosted-twice", "t1w2c3");
		expect(
			await stub.provision({ basePath: "/t1w2c3", publicUrl: ORIGIN, spacesUrl: null }),
		).toEqual({ ok: true });
		expect(
			await stub.provision({ basePath: "/other1", publicUrl: ORIGIN, spacesUrl: null }),
		).toMatchObject({ ok: false });
		expect((await stub.fetch(`${ORIGIN}/t1w2c3/health`)).status).toBe(200);
	});

	it("refuses a base path or a public URL that is not valid", async () => {
		for (const [basePath, publicUrl] of [
			["/K7Q2X9", ORIGIN],
			["/../x", ORIGIN],
			["", ORIGIN],
			["/ok1234", "https://hosted.test/path"],
			["/ok1234", "javascript:alert(1)"],
		] as const) {
			const stub = install(`hosted-bad-${basePath}-${publicUrl}`);
			expect(
				await stub.provision({ basePath, publicUrl, spacesUrl: null }),
				`${basePath} ${publicUrl}`,
			).toMatchObject({ ok: false });
		}
	});

	it("deletes all its data and its alarm with destroy(), then refuses requests", async () => {
		const stub = await provisioned("hosted-destroy", "d3s7r0");
		const admin = await stub.createAdminToken("front worker");
		const created = await stub.serve(
			new Request(`${ORIGIN}/d3s7r0/v1/projects`, {
				method: "POST",
				headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
				body: JSON.stringify({ name: "Shop" }),
			}),
			null,
		);
		expect(created.status).toBe(201);
		await stub.destroy();
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
			expect(
				state.storage.sql
					.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projects'")
					.toArray(),
			).toEqual([]);
		});
		for (const path of ["/d3s7r0/health", "/d3s7r0/v1/projects", "/health"]) {
			const response = await stub.serve(
				new Request(`${ORIGIN}${path}`, { headers: { authorization: `Bearer ${admin}` } }),
				ALICE,
			);
			expect(response.status, path).toBe(404);
		}
	});

	it("serves bearer API calls and ingest without an identity", async () => {
		const stub = await provisioned("hosted-api", "a1p2i3");
		const admin = await stub.createAdminToken("front worker");
		const created = await stub.serve(
			new Request(`${ORIGIN}/a1p2i3/v1/projects`, {
				method: "POST",
				headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" },
				body: JSON.stringify({ name: "Shop" }),
			}),
			null,
		);
		expect(created.status).toBe(201);
		const { data } = (await created.json()) as { data: { id: number; dsn: string } };
		expect(data.dsn).toMatch(/^https:\/\/[0-9a-f]+@hosted\.test\/a1p2i3\/\d+$/);
		const sent = await stub.serve(
			new Request(
				`${ORIGIN}/a1p2i3/api/${data.id}/store/?sentry_key=${new URL(data.dsn).username}`,
				{ method: "POST", body: '{"message":"hosted"}' },
			),
			null,
		);
		expect(sent.status).toBe(200);
	});
});
