import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { EncryptionKey } from "../../src/core/crypto.ts";
import { linkFix, recordDeploy } from "../../src/core/fixes.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { runScheduled } from "../../src/core/scheduler.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import type { HttpClient } from "../../src/ports/http.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "webhooks-admin-token-0123456789";
const k1: EncryptionKey = { id: "k1", key: new Uint8Array(32).fill(1) };
const k2: EncryptionKey = { id: "k2", key: new Uint8Array(32).fill(2) };

interface Sent {
	url: string;
	headers: Record<string, string>;
	body: string;
	redirect: string | undefined;
}

async function setup(options: { keys?: EncryptionKey[]; status?: number[] } = {}) {
	const sent: Sent[] = [];
	const statuses = [...(options.status ?? [])];
	const http: HttpClient = {
		send: async (url, init) => {
			sent.push({
				url,
				headers: Object.fromEntries(new Headers(init.headers).entries()),
				body: String(init.body),
				redirect: init.redirect,
			});
			return new Response(null, { status: statuses.shift() ?? 204 });
		},
	};
	const dns: Record<string, string[]> = { "hooks.example": ["93.184.216.34"] };
	const t = await testPorts({
		http,
		resolver: { resolve: async (host) => dns[host] ?? [] },
		config: { adminToken: ADMIN, encryptionKeys: options.keys ?? [k1] },
	});
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const send = async (message: string, init: { origin?: string; release?: string } = {}) => {
		await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					...(init.origin ? { origin: init.origin } : {}),
				},
				body: JSON.stringify({ message, release: init.release }),
			},
			{ ports: t.ports },
		);
		await t.settle();
	};
	const create = (body: Record<string, unknown> = {}) =>
		call("POST", "/v1/webhooks", {
			name: "agent runner",
			url: "https://hooks.example/checkend",
			events: ["issue.new", "issue.regressed", "issue.verified"],
			...body,
		});
	const cron = async () => {
		await runScheduled(t.ports, t.clock.now());
		await t.settle();
	};
	return { ...t, project, call, send, create, cron, sent, dns };
}

const verify = (secret: string, sent: Sent) => {
	const [, t, v1] =
		/^t=(\d+),v1=([0-9a-f]{64})$/.exec(sent.headers["x-checkend-signature"] ?? "") ?? [];
	return v1 === createHmac("sha256", secret).update(`${t}.${sent.body}`).digest("hex");
};

describe("webhooks: setup", () => {
	it("creates a webhook and shows its secret once; the secret is stored encrypted", async () => {
		const { create, call, ports } = await setup();
		const created = await create();
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({
			name: "agent runner",
			url: "https://hooks.example/checkend",
			events: ["issue.new", "issue.regressed", "issue.verified"],
			min_trust: "high",
			project_id: null,
			secret: expect.stringMatching(/^whsec_[A-Za-z0-9_-]{43}$/),
		});
		const listed = (await call("GET", "/v1/webhooks")).body.data;
		expect(listed).toHaveLength(1);
		expect(listed[0]).not.toHaveProperty("secret");
		const row = await ports.db.first<{ secret: string }>(sql`SELECT secret FROM webhooks`);
		expect(row?.secret).toMatch(/^enc1:k1:/);
		expect(row?.secret).not.toContain(created.body.data.secret);
	});

	it("needs ENCRYPTION_KEYS, and a public https URL", async () => {
		const noKeys = await setup({ keys: [] });
		expect((await noKeys.create()).body).toMatchObject({ error: "encryption_not_configured" });
		const { create, dns } = await setup();
		dns["inside.example"] = ["10.0.0.7"];
		for (const url of [
			"http://hooks.example/x",
			"https://inside.example/x",
			"https://169.254.169.254/latest",
			"https://unknown.example/x",
		]) {
			const response = await create({ url });
			expect(response.status, url).toBe(400);
			expect(response.body.details[0].path, url).toBe("url");
		}
		expect((await create({ events: ["issue.deleted"] })).status).toBe(400);
		expect((await create({ events: [] })).status).toBe(400);
	});

	it("deletes a webhook: no more deliveries", async () => {
		const { create, call, send, sent } = await setup();
		const id = (await create()).body.data.id;
		expect((await call("DELETE", `/v1/webhooks/${id}`)).status).toBe(200);
		expect((await call("GET", "/v1/webhooks")).body.data).toEqual([]);
		await send("cart total failed");
		expect(sent).toEqual([]);
	});
});

describe("webhooks: deliveries", () => {
	it("sends a signed issue.new delivery with the brief", async () => {
		const { create, send, sent } = await setup();
		const secret = (await create()).body.data.secret;
		await send("cart total failed");
		expect(sent).toHaveLength(1);
		const delivery = sent[0] as Sent;
		expect(delivery.url).toBe("https://hooks.example/checkend");
		expect(delivery.redirect).toBe("manual");
		expect(delivery.headers).toMatchObject({
			"content-type": "application/json",
			"x-checkend-event": "issue.new",
			"x-checkend-delivery": expect.stringMatching(/^\d+$/),
		});
		expect(verify(secret, delivery)).toBe(true);
		const body = JSON.parse(delivery.body);
		expect(body).toMatchObject({
			event: "issue.new",
			delivery_id: Number(delivery.headers["x-checkend-delivery"]),
			issue: { status: "unresolved", trust: "high", title_untrusted: "cart total failed" },
			brief: { markdown: expect.stringContaining("(brief v1)"), json: expect.any(Object) },
		});
		await send("cart total failed");
		expect(sent).toHaveLength(1); // not a new issue
	});

	it("skips low-trust issues unless min_trust is low", async () => {
		const { create, send, sent } = await setup();
		await create();
		await create({ name: "all", min_trust: "low" });
		await send("browser error", { origin: "https://shop.example" });
		expect(sent).toHaveLength(1);
		expect(JSON.parse(sent[0]?.body ?? "{}").issue.trust).toBe("low");
	});

	it("filters by event and by project", async () => {
		const { create, send, sent, ports } = await setup();
		const other = await createProject(ports, { name: "Other" });
		await create({ events: ["issue.verified"] });
		await create({ name: "other project", project: other.slug });
		await send("cart total failed");
		expect(sent).toEqual([]);
	});

	it("retries a failed delivery from the cron with a backoff, then gives up after 8 attempts", async () => {
		const { create, send, sent, cron, clock, call } = await setup({ status: Array(8).fill(500) });
		const id = (await create()).body.data.id;
		await send("cart total failed");
		expect(sent).toHaveLength(1);
		await cron();
		expect(sent).toHaveLength(1); // not due yet
		for (let i = 0; i < 10; i++) {
			clock.advance(25 * 3_600_000);
			await cron();
		}
		expect(sent).toHaveLength(8);
		const [delivery] = (await call("GET", `/v1/webhooks/${id}/deliveries`)).body.data;
		expect(delivery).toMatchObject({
			event: "issue.new",
			status: "failed",
			attempts: 8,
			last_status: 500,
		});
	});

	it("counts a redirect as a failure, and does not send to a host that now resolves to a private address", async () => {
		const { create, send, sent, dns, call } = await setup({ status: [302] });
		const id = (await create()).body.data.id;
		await send("first");
		expect(sent).toHaveLength(1);
		dns["hooks.example"] = ["127.0.0.1"];
		await send("second");
		expect(sent).toHaveLength(1);
		const deliveries = (await call("GET", `/v1/webhooks/${id}/deliveries`)).body.data;
		expect(deliveries.map((d: { last_error: string }) => d.last_error)).toEqual([
			"The host hooks.example has a private address (127.0.0.1).",
			"HTTP 302",
		]);
	});

	it("sends issue.verified and issue.regressed from the fix loop", async () => {
		const { create, send, sent, cron, clock, ports, project } = await setup();
		await create({ events: ["issue.verified", "issue.regressed"] });
		await send("cart total failed", { release: "shop@1" });
		const issue = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
		const sha = "a".repeat(40);
		await linkFix(ports, BOOTSTRAP_ADMIN, issue, { commit: sha });
		await recordDeploy(ports, BOOTSTRAP_ADMIN, {
			project: project.slug,
			release: "shop@2",
			commit: sha,
			environment: "production",
			commits: [],
			pull_requests: [],
		});
		clock.advance(25 * 3_600_000);
		await cron();
		await send("cart total failed", { release: "shop@2" });
		expect(sent.map((s) => s.headers["x-checkend-event"])).toEqual([
			"issue.verified",
			"issue.regressed",
		]);
		expect(JSON.parse(sent[1]?.body ?? "{}").issue.status).toBe("regressed");
	});

	it("sends a test ping", async () => {
		const { create, call, sent } = await setup();
		const id = (await create()).body.data.id;
		const ping = await call("POST", `/v1/webhooks/${id}/test`);
		expect(ping.status).toBe(202);
		expect(sent.map((s) => JSON.parse(s.body))).toEqual([
			expect.objectContaining({ event: "ping", issue: null, brief: null }),
		]);
	});

	it("encrypts secrets again with the current key (rotation); deliveries keep the same secret", async () => {
		const { create, send, sent, ports, cron } = await setup();
		const secret = (await create()).body.data.secret;
		ports.config.encryptionKeys = [k2, k1];
		await cron();
		const row = await ports.db.first<{ secret: string }>(sql`SELECT secret FROM webhooks`);
		expect(row?.secret).toMatch(/^enc1:k2:/);
		ports.config.encryptionKeys = [k2];
		await send("cart total failed");
		expect(verify(secret, sent[0] as Sent)).toBe(true);
	});
});
