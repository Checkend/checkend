import { describe, expect, it } from "vitest";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { createProject } from "../../../src/core/projects.ts";
import { createApp } from "../../../src/http/app.ts";
import { sql } from "../../../src/ports/db.ts";
import type { Ports } from "../../../src/ports/index.ts";
import { loadSentryFixtures } from "../../fixtures/sentry/load.ts";
import { testPorts } from "../../support/node-ports.ts";

async function setup(overrides: Partial<Ports> = {}) {
	const t = await testPorts(overrides);
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const send = (path: string, init: RequestInit = {}) =>
		app.request(`https://checkend.test${path}`, init, { ports: t.ports });
	const envelopePath = (query = `sentry_key=${project.publicKey}&sentry_version=7`) =>
		`/api/${project.id}/envelope/?${query}`;
	const count = async (table: "issues" | "events") =>
		(
			await t.ports.db.first<{ n: number }>({
				// biome-ignore lint/plugin: the table name is one of two fixed names.
				sql: `SELECT COUNT(*) AS n FROM ${table}`,
				params: [],
			})
		)?.n;
	return { ...t, project, state, app, send, envelopePath, count };
}

const envelope = (event: Record<string, unknown>, header: Record<string, unknown> = {}) =>
	`${JSON.stringify(header)}\n{"type":"event"}\n${JSON.stringify(event)}\n`;

describe("ingest: golden fixtures end to end", () => {
	it.each(loadSentryFixtures().map((f) => [f.name, f] as const))(
		"accepts %s",
		async (_name, fixture) => {
			const { send, project, settle, ports } = await setup();
			const query = new URL(`https://x${fixture.path}`).searchParams;
			query.set("sentry_key", project.publicKey);
			const response = await send(`/api/${project.id}/envelope/?${query}`, {
				method: "POST",
				headers: fixture.headers,
				body: fixture.body,
			});
			expect(response.status).toBe(200);
			const body = (await response.json()) as { id: string };
			expect(body.id).toMatch(/^[0-9a-f]{32}$/);
			await settle();
			const event = await ports.db.first<{ event_id: string; issue_id: number }>(
				sql`SELECT event_id, issue_id FROM events`,
			);
			expect(event?.event_id).toBe(body.id);
			const issue = await ports.db.first<{ title: string }>(sql`SELECT title FROM issues`);
			expect(issue?.title.length).toBeGreaterThan(0);
		},
	);

	it("groups the same Node error sent twice into one issue", async () => {
		const { send, project, settle, ports } = await setup();
		const fixture = loadSentryFixtures().find((f) => f.name === "node-type-error");
		if (!fixture) throw new Error("fixture");
		// The second event gets a new event_id, like a second occurrence.
		const text = new TextDecoder().decode(fixture.body);
		const second = text.replaceAll(/"event_id":"[0-9a-f]{32}"/g, `"event_id":"${"a".repeat(32)}"`);
		for (const body of [fixture.body, second]) {
			await send(`/api/${project.id}/envelope/?sentry_key=${project.publicKey}`, {
				method: "POST",
				body,
			});
		}
		await settle();
		expect(await ports.db.all(sql`SELECT times_seen, stored_events FROM issues`)).toEqual([
			{ times_seen: 2, stored_events: 2 },
		]);
	});
});

describe("ingest: authentication (layer 1)", () => {
	it("accepts the key in the X-Sentry-Auth header", async () => {
		const { send, project } = await setup();
		const response = await send(`/api/${project.id}/envelope/`, {
			method: "POST",
			headers: {
				"x-sentry-auth": `Sentry sentry_version=7, sentry_key=${project.publicKey}, sentry_client=x/1`,
			},
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(200);
	});

	it("accepts the key in the envelope header dsn when there is no other key (tunnel)", async () => {
		const { send, project } = await setup();
		const dsn = `https://${project.publicKey}@checkend.test/${project.id}`;
		const response = await send(`/api/${project.id}/envelope/`, {
			method: "POST",
			body: envelope({ message: "hi" }, { dsn }),
		});
		expect(response.status).toBe(200);
	});

	it.each([
		["no key", (_k: string) => ""],
		["an unknown key", (_k: string) => `sentry_key=${"0".repeat(32)}`],
		["a malformed key", (_k: string) => "sentry_key=abc"],
	])("rejects %s with 401 and stores nothing", async (_label, query) => {
		const { send, project, settle, count } = await setup();
		const response = await send(`/api/${project.id}/envelope/?${query(project.publicKey)}`, {
			method: "POST",
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(401);
		await settle();
		expect(await count("issues")).toBe(0);
	});

	it("rejects a valid key used with another project ID", async () => {
		const { send, project, ports } = await setup();
		const other = await createProject(ports, { name: "Other" });
		const response = await send(`/api/${other.id}/envelope/?sentry_key=${project.publicKey}`, {
			method: "POST",
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(401);
	});

	it("returns 404 for a project ID that is not a number", async () => {
		const { send } = await setup();
		expect((await send("/api/abc/envelope/", { method: "POST", body: "x" })).status).toBe(404);
	});
});

describe("ingest: back-pressure (H1) and rate limits", () => {
	it("answers 429 with Retry-After and X-Sentry-Rate-Limits when the key is over its rate limit", async () => {
		const { send, envelopePath, count, settle } = await setup({
			rateLimiter: { allow: async () => false },
		});
		const response = await send(envelopePath(), {
			method: "POST",
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
		expect(response.headers.get("x-sentry-rate-limits")).toBe("60::key");
		await settle();
		expect(await count("issues")).toBe(0);
	});

	it("answers 429 while D1 is overloaded", async () => {
		const { send, envelopePath, state, clock } = await setup();
		for (let i = 0; i < 3; i++) state.health.recordFailure(clock.now());
		const response = await send(envelopePath(), {
			method: "POST",
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("30");
		expect(response.headers.get("x-sentry-rate-limits")).toBe("30::organization");
	});
});

describe("ingest: request checks", () => {
	it("rejects a body above the cap with 413", async () => {
		const { send, envelopePath } = await setup();
		const response = await send(envelopePath(), {
			method: "POST",
			headers: { "content-length": String(2 * 1024 * 1024) },
			body: "x",
		});
		expect(response.status).toBe(413);
	});

	it("rejects an unsupported content type with 415", async () => {
		const { send, envelopePath } = await setup();
		const response = await send(envelopePath(), {
			method: "POST",
			headers: { "content-type": "text/html" },
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(415);
	});

	it("rejects an event that is not valid JSON with 400", async () => {
		const { send, envelopePath } = await setup();
		const response = await send(envelopePath(), {
			method: "POST",
			body: '{}\n{"type":"event"}\n{nope\n',
		});
		expect(response.status).toBe(400);
	});

	it("accepts and drops an envelope without an error event", async () => {
		const { send, envelopePath, settle, count } = await setup();
		const response = await send(envelopePath(), {
			method: "POST",
			body: '{}\n{"type":"session"}\n{"sid":"x"}\n',
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({});
		await settle();
		expect(await count("issues")).toBe(0);
	});

	it("accepts the legacy store endpoint with a JSON event", async () => {
		const { send, project, settle, count } = await setup();
		const response = await send(`/api/${project.id}/store/?sentry_key=${project.publicKey}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message: "from store" }),
		});
		expect(response.status).toBe(200);
		await settle();
		expect(await count("events")).toBe(1);
	});

	it("accepts the paths without the trailing slash", async () => {
		const { send, project } = await setup();
		const response = await send(`/api/${project.id}/envelope?sentry_key=${project.publicKey}`, {
			method: "POST",
			body: envelope({ message: "hi" }),
		});
		expect(response.status).toBe(200);
	});
});

describe("ingest: CORS for browser SDKs", () => {
	it("answers a preflight request", async () => {
		const { send, project } = await setup();
		const response = await send(`/api/${project.id}/envelope/`, {
			method: "OPTIONS",
			headers: { origin: "https://shop.example", "access-control-request-method": "POST" },
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-allow-methods")).toContain("POST");
	});

	it("allows the browser to read the response and the rate-limit headers", async () => {
		const { send, envelopePath } = await setup();
		const response = await send(envelopePath(), {
			method: "POST",
			headers: { origin: "https://shop.example" },
			body: envelope({ message: "hi" }),
		});
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		expect(response.headers.get("access-control-expose-headers")).toMatch(/x-sentry-rate-limits/i);
	});
});
