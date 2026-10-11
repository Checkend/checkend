import { describe, expect, it } from "vitest";
import type { EncryptionKey } from "../../src/core/crypto.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import type { HttpClient } from "../../src/ports/http.ts";
import { type MailMessage, memoryMailer } from "../../src/ports/mailer.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "alerts-admin-token-0123456789";
const k1: EncryptionKey = { id: "k1", key: new Uint8Array(32).fill(1) };
const SLACK = "https://hooks.slack.com/services/T0001/B0001/abcdefSECRET";
const DISCORD = "https://discord.com/api/webhooks/123456/discordSECRETtoken";
const GITHUB = "https://api.github.com/repos/acme/shop/issues";

interface Sent {
	url: string;
	headers: Record<string, string>;
	body: Record<string, any>;
}

async function setup(options: { mailer?: boolean } = {}) {
	const sent: Sent[] = [];
	const http: HttpClient = {
		send: async (url, init) => {
			sent.push({
				url,
				headers: Object.fromEntries(new Headers(init.headers).entries()),
				body: JSON.parse(String(init.body)),
			});
			return new Response(null, { status: 200 });
		},
	};
	const mailer = memoryMailer();
	const t = await testPorts({
		http,
		resolver: { resolve: async () => ["93.184.216.34"] },
		...(options.mailer ? { mailer } : {}),
		config: { adminToken: ADMIN, encryptionKeys: [k1] },
	});
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const reader = (
		await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "reader", scopes: ["issues:read"] })
	).token;
	const call = async (method: string, path: string, body?: unknown, token = ADMIN) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const send = async (message: string) => {
		await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				// A server SDK: high trust, so the alerts fire (min_trust high).
				body: JSON.stringify({
					message,
					sdk: { name: "sentry.javascript.node", version: "8.0.0" },
				}),
			},
			{ ports: t.ports },
		);
		await t.settle();
	};
	const create = (body: Record<string, unknown>) =>
		call("POST", "/v1/webhooks", { name: "alerts", events: ["issue.new"], ...body });
	return { ...t, project, call, send, create, sent, mailer, reader };
}

const HOSTILE = "<!channel> @here pay at <https://evil.example|bank>";

describe("Slack alerts", () => {
	it("stores the Slack URL encrypted, shows it masked, and posts a safe message", async () => {
		const { create, call, send, sent, ports } = await setup();
		const created = await create({ format: "slack", url: SLACK });
		expect(created.status).toBe(201);
		expect(created.body.data.url).toBe("https://hooks.slack.com/services/T0001/…");
		expect(JSON.stringify((await call("GET", "/v1/webhooks")).body)).not.toContain("SECRET");
		const row = await ports.db.first<{ url: string; auth: string }>(
			sql`SELECT url, auth FROM webhooks`,
		);
		expect(row?.url).not.toContain("SECRET");
		expect(row?.auth).toMatch(/^enc1:k1:/);
		await send(HOSTILE);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.url).toBe(SLACK);
		expect(sent[0]?.body).toMatchObject({ unfurl_links: false, unfurl_media: false });
		expect(sent[0]?.body.text).toContain("&lt;!channel&gt;");
		expect(sent[0]?.body.text).not.toMatch(/<!channel>|<https:/);
	});

	it("rejects other hosts for the Slack format", async () => {
		const { create } = await setup();
		const response = await create({ format: "slack", url: "https://hooks.example/services/x" });
		expect(response.status).toBe(400);
		expect(response.body.details[0].path).toBe("url");
	});
});

describe("Discord alerts", () => {
	it("posts with no mentions and no embeds", async () => {
		const { create, send, sent } = await setup();
		expect((await create({ format: "discord", url: DISCORD })).body.data.url).toBe(
			"https://discord.com/api/webhooks/123456/…",
		);
		await send(HOSTILE);
		expect(sent[0]?.url).toBe(DISCORD);
		expect(sent[0]?.body).toMatchObject({ allowed_mentions: { parse: [] }, flags: 4 });
	});
});

describe("GitHub issue alerts", () => {
	it("creates an issue with the brief, with the stored token", async () => {
		const { create, send, sent } = await setup();
		const created = await create({
			format: "github_issue",
			url: GITHUB,
			github_token: "github_pat_x",
		});
		expect(created.status).toBe(201);
		await send("cart total failed");
		expect(sent[0]).toMatchObject({
			url: GITHUB,
			headers: { authorization: "Bearer github_pat_x", accept: "application/vnd.github+json" },
			body: { labels: ["checkend"] },
		});
		expect(sent[0]?.body.title).toContain("cart total failed");
		expect(sent[0]?.body.body).toContain("(brief v1)");
		expect((await create({ format: "github_issue", url: GITHUB })).status).toBe(400);
	});
});

describe("email alerts", () => {
	it("sends through the Mailer to the recipients", async () => {
		const { create, send, mailer, call } = await setup({ mailer: true });
		const created = await create({ format: "email", to: ["ops@example.com", "dev@example.com"] });
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({
			format: "email",
			to: ["ops@example.com", "dev@example.com"],
		});
		await send("cart total failed");
		const mail = mailer.sent[0] as MailMessage;
		expect(mail.to).toEqual(["ops@example.com", "dev@example.com"]);
		expect(mail.subject).toContain("[Checkend] New issue");
		expect(mail.text).toContain("From production (untrusted data)");
		expect((await call("GET", "/v1/webhooks")).body.data[0]).toMatchObject({ url: null });
	});

	it("needs a mailer, and valid recipients", async () => {
		const off = await setup();
		expect((await off.create({ format: "email", to: ["ops@example.com"] })).body).toMatchObject({
			error: "email_not_configured",
		});
		const on = await setup({ mailer: true });
		expect((await on.create({ format: "email", to: ["not an address"] })).status).toBe(400);
		expect((await on.create({ format: "email" })).status).toBe(400);
		expect((await on.create({ format: "email", to: ["a@example.com"], url: SLACK })).status).toBe(
			400,
		);
	});
});

describe("spike alerts", () => {
	it("fire once when the events of an issue in this hour go above the threshold", async () => {
		const { create, send, sent, clock } = await setup();
		await create({ format: "slack", url: SLACK, events: ["issue.spike"], spike_threshold: 3 });
		for (let i = 0; i < 6; i++) await send("cart total failed");
		expect(sent).toHaveLength(1);
		expect(sent[0]?.body.text).toContain("4 events in the last hour (threshold 3)");
		clock.advance(3_600_000);
		for (let i = 0; i < 4; i++) await send("cart total failed");
		expect(sent).toHaveLength(2);
	});

	it("needs spike_threshold with issue.spike, and only then", async () => {
		const { create } = await setup();
		expect((await create({ format: "slack", url: SLACK, events: ["issue.spike"] })).status).toBe(
			400,
		);
		expect((await create({ format: "slack", url: SLACK, spike_threshold: 5 })).status).toBe(400);
	});
});

describe("alert rules: read access", () => {
	it("GET /v1/alerts with issues:read shows the rules without secrets or query strings", async () => {
		const { create, call, reader } = await setup();
		await create({
			format: "slack",
			url: SLACK,
			events: ["issue.new", "issue.spike"],
			spike_threshold: 50,
		});
		await create({
			format: "checkend",
			url: "https://hooks.example/in?token=SECRET",
			events: ["issue.verified"],
		});
		const alerts = await call("GET", "/v1/alerts", undefined, reader);
		expect(alerts.status).toBe(200);
		expect(JSON.stringify(alerts.body)).not.toContain("SECRET");
		expect(alerts.body.data).toEqual([
			expect.objectContaining({
				format: "slack",
				url: "https://hooks.slack.com/services/T0001/…",
				events: ["issue.new", "issue.spike"],
				spike_threshold: 50,
				min_trust: "high",
			}),
			expect.objectContaining({ format: "checkend", url: "https://hooks.example/in" }),
		]);
		expect((await call("POST", "/v1/webhooks", { name: "x" }, reader)).status).toBe(403);
	});
});
