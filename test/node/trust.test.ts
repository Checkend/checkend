import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "trust-admin-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const send = async (origin?: string, message = "cart total failed") => {
		const response = await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
				body: JSON.stringify({ message }),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return response.status;
	};
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
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const issueId = async () =>
		(await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues ORDER BY id`))?.id as number;
	return { ...t, project, send, call, issueId };
}

describe("trust levels by source", () => {
	it("a project that only gets server events has high trust", async () => {
		const { send, call, issueId } = await setup();
		expect(await send()).toBe(200);
		expect((await call("GET", `/v1/issues/${await issueId()}`)).body.data.trust).toBe("high");
		expect((await call("GET", "/v1/projects")).body.data[0]).toMatchObject({
			trust: "high",
			trust_setting: null,
			allowed_origins: null,
		});
	});

	it("a browser event (Origin header) makes the project low trust: its DSN is public", async () => {
		const { send, call, issueId, ports } = await setup();
		await send();
		await send("https://shop.example", "a browser error");
		const issues: { trust: string }[] = (await call("GET", "/v1/issues")).body.data;
		expect(issues.map((issue) => issue.trust)).toEqual(["low", "low"]);
		const brief = await buildBrief(ports.db, await issueId(), ports.clock.now());
		expect(brief?.json.issue.trust).toBe("low");
		expect(brief?.markdown).toContain(
			"| Trust | low: the DSN can be public (browser), so anyone can send events |",
		);
		// A server event later does not make it high again.
		await send();
		expect((await call("GET", "/v1/projects")).body.data[0].trust).toBe("low");
	});

	it("an admin can set the trust (high, low, or null for automatic)", async () => {
		const { send, call, project } = await setup();
		await send("https://shop.example");
		const high = await call("PATCH", `/v1/projects/${project.slug}`, { trust: "high" });
		expect(high.body.data).toMatchObject({ trust: "high", trust_setting: "high" });
		const auto = await call("PATCH", `/v1/projects/${project.slug}`, { trust: null });
		expect(auto.body.data).toMatchObject({ trust: "low", trust_setting: null });
		expect((await call("PATCH", `/v1/projects/${project.slug}`, { trust: "max" })).status).toBe(
			400,
		);
	});
});

describe("allowed origins per browser project", () => {
	it("rejects browser events from other origins with 403; server events still work", async () => {
		const { send, call, project, clock } = await setup();
		const set = await call("PATCH", `/v1/projects/${project.slug}`, {
			allowed_origins: ["https://shop.example", "http://localhost:3000"],
		});
		expect(set.body.data.allowed_origins).toEqual([
			"https://shop.example",
			"http://localhost:3000",
		]);
		expect(await send("https://shop.example")).toBe(200);
		expect(await send("http://localhost:3000")).toBe(200);
		expect(await send("https://evil.example")).toBe(403);
		expect(await send("null")).toBe(403);
		expect(await send()).toBe(200);
		await call("PATCH", `/v1/projects/${project.slug}`, { allowed_origins: null });
		clock.advance(61_000); // the DSN key cache keeps the project for 60 seconds
		expect(await send("https://evil.example")).toBe(200);
	});

	it("validates the origins", async () => {
		const { call, project } = await setup();
		for (const allowed_origins of [
			["shop.example"],
			["https://shop.example/path"],
			["https://*.example"],
			Array.from({ length: 21 }, (_, i) => `https://s${i}.example`),
		]) {
			expect(
				(await call("PATCH", `/v1/projects/${project.slug}`, { allowed_origins })).status,
				JSON.stringify(allowed_origins).slice(0, 60),
			).toBe(400);
		}
	});
});
