import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/entry/migrations.generated.ts";

/** An install (one Durable Object); the front Worker reaches it with stub.fetch and RPC. */
const install = (name: string) => env.INSTALL.get(env.INSTALL.idFromName(name));

const call = async (
	stub: ReturnType<typeof install>,
	method: string,
	path: string,
	token: string | null,
	body?: unknown,
) => {
	const response = await stub.fetch(`https://install.example${path}`, {
		method,
		headers: {
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	return { status: response.status, body: (await response.json()) as Record<string, any> };
};

describe("the hosted install (one Durable Object = one install)", () => {
	it("applies all migrations on its first start, and sets its alarm", async () => {
		const stub = install("first-start");
		const health = await call(stub, "GET", "/health", null);
		expect(health.body).toMatchObject({
			status: "ok",
			migrations: { latest: MIGRATIONS.at(-1)?.name },
		});
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).not.toBeNull();
		});
	});

	it("serves the whole app: an admin token from the front Worker, a project, ingest, the issue", async () => {
		const stub = install("flow");
		const admin = await stub.createAdminToken("front worker");
		expect(admin).toMatch(/^ck_/);
		const project = await call(stub, "POST", "/v1/projects", admin, { name: "Shop" });
		expect(project.status).toBe(201);
		const key = new URL(project.body.data.dsn).username;
		const sent = await stub.fetch(
			`https://install.example/api/${project.body.data.id}/store/?sentry_key=${key}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: '{"message":"install error"}',
			},
		);
		expect(sent.status).toBe(200);
		await runInDurableObject(stub, async () => {}); // let the deferred write finish
		const issues = await call(stub, "GET", "/v1/issues", admin);
		expect(issues.body.data.map((i: { title: string }) => i.title)).toEqual(["install error"]);
	});

	it("keeps installs apart, and does not accept the shared ADMIN_TOKEN of the Worker", async () => {
		const a = install("apart-a");
		const b = install("apart-b");
		const tokenA = await a.createAdminToken("front worker");
		await call(a, "POST", "/v1/projects", tokenA, { name: "Only in A" });
		expect((await call(b, "GET", "/v1/projects", tokenA)).status).toBe(401);
		const tokenB = await b.createAdminToken("front worker");
		expect((await call(b, "GET", "/v1/projects", tokenB)).body.data).toEqual([]);
		expect((await call(a, "GET", "/v1/projects", env.ADMIN_TOKEN)).status).toBe(401);
	});

	it("runs the scheduled jobs in its alarm and sets the next alarm", async () => {
		const stub = install("alarm");
		await call(stub, "GET", "/health", null);
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		await runInDurableObject(stub, async (_instance, state) => {
			const next = await state.storage.getAlarm();
			expect(next).not.toBeNull();
			expect((next ?? 0) - Date.now()).toBeGreaterThan(60_000);
		});
	});

	it("keeps its blobs under its own prefix in the shared bucket", async () => {
		const stub = install("blobs");
		const prefix = await runInDurableObject(stub, async (instance) => instance.blobPrefix());
		expect(prefix).toMatch(/^installs\/[0-9a-f]{64}\/$/);
		await runInDurableObject(stub, async (instance) => {
			await instance.blobs()?.put("probe", "x");
		});
		expect(await env.BLOBS.get(`${prefix}probe`)).not.toBeNull();
		expect(await env.BLOBS.get("probe")).toBeNull();
	});
});
