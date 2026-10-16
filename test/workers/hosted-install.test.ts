import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { readConfig } from "../../src/adapters/config-env.ts";
import type { FrontIdentity } from "../../src/core/auth/front-identity.ts";
import { decryptValue, encryptValue } from "../../src/core/crypto.ts";
import {
	ACTIVE_ALARM_MS,
	ACTIVITY_KEY,
	HOSTED_DAILY_EVENT_LIMIT,
	IDLE_AFTER_MS,
	IDLE_ALARM_MS,
	ingestLimitKey,
} from "../../src/entry/durable-object.ts";

/**
 * A hosted install as the front Worker uses it: provisioned once with its base path, then called
 * with `serve(request, identity)`. The identity is an argument of the call, never a header.
 */
const ORIGIN = "https://hosted.test";
const ALICE: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };
const install = (name: string) => env.INSTALL.get(env.INSTALL.idFromName(name));

/** A request through serve() with a base path in the call. */
const stub = (
	target: ReturnType<typeof install>,
	url: string,
	at: { basePath: string; publicUrl: string; standIn?: boolean },
) => target.serve(new Request(url), null, at);

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

	it("always has a daily event limit, so that a flood with a public DSN cannot write without end", async () => {
		const stub = await provisioned("hosted-event-limit", "e1v2l3");
		const config = await runInDurableObject(stub, async (instance) => instance.config());
		expect(HOSTED_DAILY_EVENT_LIMIT).toBeGreaterThan(0);
		expect(config.dailyEventLimit).toBe(HOSTED_DAILY_EVENT_LIMIT);
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

	it("encrypts with its own keys: another install cannot decrypt its values", async () => {
		const a = await provisioned("hosted-keys-a", "k3y5aa");
		const b = await provisioned("hosted-keys-b", "k3y5bb");
		const keysA = await runInDurableObject(a, async (instance) => instance.config().encryptionKeys);
		const keysB = await runInDurableObject(b, async (instance) => instance.config().encryptionKeys);
		const shared = readConfig(env).encryptionKeys;
		expect(shared.map((k) => k.id)).toEqual(["k1"]);
		expect(keysA.map((k) => k.id)).toEqual(["k1"]);
		expect(keysB.map((k) => k.id)).toEqual(["k1"]);
		const stored = await encryptValue(keysA, "whsec_value", "webhooks.secret:1");
		expect(await decryptValue(keysA, stored, "webhooks.secret:1")).toBe("whsec_value");
		await expect(decryptValue(keysB, stored, "webhooks.secret:1")).rejects.toThrow();
		await expect(decryptValue(shared, stored, "webhooks.secret:1")).rejects.toThrow();
		const storedB = await encryptValue(keysB, "whsec_value", "webhooks.secret:1");
		await expect(decryptValue(keysA, storedB, "webhooks.secret:1")).rejects.toThrow();
	});

	it("deletes its blobs in the shared bucket with destroy(), in chunks, and no other install's", async () => {
		const stub = await provisioned("hosted-blobs", "b1o2b3");
		const other = await provisioned("hosted-blobs-other", "b4o5b6");
		const prefix = await runInDurableObject(stub, async (instance) => instance.blobPrefix());
		const otherPrefix = await runInDurableObject(other, async (instance) => instance.blobPrefix());
		// More than one list page (R2 lists at most 1000 keys at a time).
		const keys = Array.from({ length: 1003 }, (_, i) => `${prefix}maps/${i}`);
		for (let i = 0; i < keys.length; i += 100) {
			await Promise.all(keys.slice(i, i + 100).map((key) => env.BLOBS.put(key, "x")));
		}
		await env.BLOBS.put(`${otherPrefix}maps/keep`, "x");
		await stub.destroy();
		expect((await env.BLOBS.list({ prefix })).objects).toEqual([]);
		expect(await env.BLOBS.get(`${otherPrefix}maps/keep`)).not.toBeNull();
		// 1003 puts and deletes in the local R2 take about 5 s on a CI runner: more than the default.
	}, 30_000);

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

	it("shows only its status and version on /health under a base path", async () => {
		const stub = await provisioned("hosted-health", "h3a1t7");
		const health = await stub.fetch(`${ORIGIN}/h3a1t7/health`);
		expect(health.status).toBe(200);
		expect(Object.keys((await health.json()) as object).sort()).toEqual(["status", "version"]);
	});

	it("refuses another base path in the call when it is provisioned", async () => {
		const stub = await provisioned("hosted-at", "a7b8c9");
		const at = { basePath: "/z9y8x7", publicUrl: ORIGIN };
		expect((await stub.serve(new Request(`${ORIGIN}/z9y8x7/health`), null, at)).status).toBe(404);
		expect((await stub.serve(new Request(`${ORIGIN}/a7b8c9/health`), null, at)).status).toBe(404);
		const own = { basePath: "/a7b8c9", publicUrl: ORIGIN };
		expect((await stub.serve(new Request(`${ORIGIN}/a7b8c9/health`), null, own)).status).toBe(200);
	});

	it("answers under the base path of the call in the stand-in mode only", async () => {
		// A front Worker sends requests for unknown paths to empty stand-in installs, so that they
		// get the same answers as a real install without credentials.
		const empty = install("hosted-empty");
		for (const id of ["e1e2e3", "f4f5f6"]) {
			const at = { basePath: `/${id}`, publicUrl: ORIGIN, standIn: true };
			const llms = await stub(empty, `${ORIGIN}/${id}/llms.txt`, at);
			expect(llms.status).toBe(200);
			expect(await llms.text()).toContain(`${ORIGIN}/${id}/mcp`);
			expect((await stub(empty, `${ORIGIN}/${id}/v1/projects`, at)).status).toBe(401);
			expect((await stub(empty, `${ORIGIN}/other/v1/projects`, at)).status).toBe(404);
			const health = (await (await stub(empty, `${ORIGIN}/${id}/health`, at)).json()) as object;
			expect(Object.keys(health).sort()).toEqual(["status", "version"]);
			// Never for a member.
			const member = await empty.serve(new Request(`${ORIGIN}/${id}/issues`), ALICE, at);
			expect(member.status).toBe(404);
		}
		for (const at of [
			{ basePath: "/../x", publicUrl: ORIGIN, standIn: true },
			{ basePath: "/ok1234", publicUrl: "javascript:x", standIn: true },
			// Without the stand-in mode, an install that is not provisioned refuses.
			{ basePath: "/ok1234", publicUrl: ORIGIN },
		]) {
			expect((await stub(empty, `${ORIGIN}/ok1234/health`, at)).status).toBe(404);
		}
		expect((await empty.fetch(`${ORIGIN}/health`)).status).toBe(404);
		expect((await empty.serve(new Request(`${ORIGIN}/health`), null)).status).toBe(404);
	});

	it("sets no alarm while not provisioned, and an alarm that runs then removes itself", async () => {
		const empty = install("hosted-no-alarm");
		await stub(empty, `${ORIGIN}/n0a1a2/health`, {
			basePath: "/n0a1a2",
			publicUrl: ORIGIN,
			standIn: true,
		});
		await runInDurableObject(empty, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
			await state.storage.setAlarm(Date.now() + 60_000);
		});
		expect(await runDurableObjectAlarm(empty)).toBe(true);
		await runInDurableObject(empty, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
		});
	});

	it("stays deleted after a restart: no migrations, no alarm, no data, no answers", async () => {
		const deleted = await provisioned("hosted-tombstone", "t0m6b5");
		expect((await deleted.serve(new Request(`${ORIGIN}/t0m6b5/issues`), ALICE)).status).toBe(200);
		await deleted.destroy();
		// A restart (a deploy, an eviction): the object is built again from its storage.
		await runInDurableObject(deleted, (_instance, state) => state.abort("restart")).catch(() => {});
		const again = install("hosted-tombstone");
		for (const at of [
			null,
			{ basePath: "/t0m6b5", publicUrl: ORIGIN },
			{ basePath: "/t0m6b5", publicUrl: ORIGIN, standIn: true },
		]) {
			const page = await again.serve(new Request(`${ORIGIN}/t0m6b5/issues`), ALICE, at);
			expect(page.status).toBe(404);
		}
		expect(
			await again.provision({ basePath: "/t0m6b5", publicUrl: ORIGIN, spacesUrl: null }),
		).toMatchObject({ ok: false });
		await runInDurableObject(again, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeNull();
			const tables = state.storage.sql
				.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'members'")
				.toArray();
			expect(tables).toEqual([]);
		});
	});

	it("wakes every 5 minutes while in use, and rarely when nobody used it for days", async () => {
		const stub = await provisioned("hosted-idle", "i1d2l3");
		const alarmIn = () =>
			runInDurableObject(
				stub,
				async (_i, state) => ((await state.storage.getAlarm()) ?? 0) - Date.now(),
			);
		expect(await alarmIn()).toBeLessThanOrEqual(ACTIVE_ALARM_MS);
		// Used recently: the next alarm is in 5 minutes.
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(await alarmIn()).toBeLessThanOrEqual(ACTIVE_ALARM_MS);
		// No request for longer than IDLE_AFTER_MS: the alarm runs at the idle interval.
		await runInDurableObject(stub, async (_i, state) => {
			await state.storage.put(ACTIVITY_KEY, Date.now() - IDLE_AFTER_MS - 60_000);
			await state.storage.setAlarm(Date.now() + 1000);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);
		expect(await alarmIn()).toBeGreaterThan(IDLE_ALARM_MS - 60_000);
		// A request makes it active again: the next alarm is in 5 minutes.
		const health = await stub.serve(new Request(`${ORIGIN}/i1d2l3/health`), null);
		expect(health.status).toBe(200);
		expect(await alarmIn()).toBeLessThanOrEqual(ACTIVE_ALARM_MS);
	});

	it("keys the ingest limit by its base path, not by the object", () => {
		expect(ingestLimitKey("/k7q2x9", "object-a", "dsnkey")).toBe("/k7q2x9:dsnkey");
		expect(ingestLimitKey("/k7q2x9", "object-b", "dsnkey")).toBe("/k7q2x9:dsnkey");
		expect(ingestLimitKey("", "object-a", "dsnkey")).toBe("object-a:dsnkey");
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
