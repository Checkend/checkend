import { describe, expect, it } from "vitest";
import { BOOTSTRAP_ADMIN, createToken } from "../../../src/core/tokens.ts";
import { ADMIN, setupApi } from "../../support/setup-api.ts";

describe("/v1/setup/keys", () => {
	it("an admin creates, lists and revokes setup keys", async () => {
		const { call } = await setupApi();
		const created = await call("POST", "/v1/setup/keys", ADMIN);
		expect(created.status).toBe(201);
		expect(created.body?.data).toMatchObject({
			key: expect.stringMatching(/^cks_/),
			expires_at: expect.any(String),
		});
		const list = await call("GET", "/v1/setup/keys", ADMIN);
		expect(list.body?.data).toHaveLength(1);
		expect(JSON.stringify(list.body)).not.toContain(created.body?.data.key);
		expect((await call("DELETE", `/v1/setup/keys/${created.body?.data.id}`, ADMIN)).status).toBe(
			204,
		);
		expect((await call("DELETE", `/v1/setup/keys/${created.body?.data.id}`, ADMIN)).status).toBe(
			404,
		);
	});

	it("needs an admin: not a scoped token, not a setup key, not nothing", async () => {
		const { call, ports, newKey } = await setupApi();
		const { token } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "w",
			scopes: ["issues:write"],
		});
		expect((await call("POST", "/v1/setup/keys", token)).status).toBe(403);
		expect((await call("POST", "/v1/setup/keys", await newKey())).status).toBe(403);
		expect((await call("POST", "/v1/setup/keys", null)).status).toBe(401);
	});

	it("a setup key opens no other /v1 route", async () => {
		const { call, newKey } = await setupApi();
		const key = await newKey();
		for (const [method, path] of [
			["GET", "/v1/projects"],
			["GET", "/v1/issues"],
			["GET", "/v1/tokens"],
			["POST", "/v1/tokens"],
			["GET", "/v1/activity"],
		] as const) {
			expect((await call(method, path, key)).status).toBe(401);
		}
	});
});

describe("the agent steps with a setup key", () => {
	it("registers an app, makes a token, sends the test event and reports the SDK", async () => {
		const { call, newKey } = await setupApi();
		const key = await newKey();
		const app = await call("POST", "/v1/setup/apps", key, { name: "shop-api", platform: "node" });
		expect(app.status).toBe(201);
		expect(app.body?.data).toMatchObject({
			project: { name: "shop-api", slug: "shop-api", platform: "node" },
			dsn: expect.stringMatching(/^http:\/\/[0-9a-f]{32}@localhost\/\d{10}$/),
		});
		expect((await call("POST", "/v1/setup/apps", key, { name: "shop-api" })).status).toBe(200);
		const project = app.body?.data.project.slug;
		const token = await call("POST", "/v1/setup/tokens", key, { name: "Claude Code", project });
		expect(token.status).toBe(201);
		expect(token.body?.data).toMatchObject({
			token: expect.stringMatching(/^ck_/),
			scopes: ["issues:read", "issues:write"],
		});
		expect((await call("GET", "/v1/issues", token.body?.data.token)).status).toBe(200);
		expect((await call("POST", `/v1/setup/apps/${project}/test-event`, key)).status).toBe(202);
		expect((await call("POST", `/v1/setup/apps/${project}/test-event`, key)).status).toBe(409);
		expect(
			(await call("POST", `/v1/setup/apps/${project}/report`, key, { step: "sdk_installed" }))
				.status,
		).toBe(204);
		expect(
			(await call("POST", `/v1/setup/apps/${project}/report`, key, { step: "deleted_all" })).status,
		).toBe(400);
		expect((await call("POST", "/v1/setup/apps/nope/test-event", key)).status).toBe(404);
	});

	it("rejects a scoped token without admin, and bad bodies", async () => {
		const { call, ports, newKey } = await setupApi();
		const { token } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "r",
			scopes: ["issues:read"],
		});
		expect((await call("POST", "/v1/setup/apps", token, { name: "x" })).status).toBe(403);
		const key = await newKey();
		expect((await call("POST", "/v1/setup/apps", key, { name: "" })).status).toBe(400);
		expect((await call("POST", "/v1/setup/tokens", key, { name: "t" })).status).toBe(400);
	});
});

describe("GET /v1/setup/progress", () => {
	it("shows the agent after its first MCP call, for the key and for an admin", async () => {
		const { call, newKey, app, ports, settle } = await setupApi();
		const key = await newKey();
		const registered = await call("POST", "/v1/setup/apps", key, { name: "shop-api" });
		const project = registered.body?.data.project.slug;
		const token = (await call("POST", "/v1/setup/tokens", key, { name: "Claude Code", project }))
			.body?.data.token;
		const mcp = await app.request(
			"/mcp",
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${token}`,
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "claude-code", version: "2" },
					},
				}),
			},
			{ ports },
		);
		expect(mcp.status).toBe(200);
		await settle();
		const mine = await call("GET", "/v1/setup/progress", key);
		expect(mine.status).toBe(200);
		expect(mine.body?.data.apps).toEqual([
			expect.objectContaining({ agent: { name: "claude-code", at: "2026-10-10T12:00:00.000Z" } }),
		]);
		const all = await call("GET", "/v1/setup/progress", ADMIN);
		expect(all.body?.data).toMatchObject({ setup_keys_active: 1, apps: [expect.any(Object)] });
	});
});

describe("the agent token of a setup key (ce setup report, after the key)", () => {
	it("reports for its own app only, also after the key expires, and cannot set up more", async () => {
		const { call, newKey, clock } = await setupApi();
		const key = await newKey();
		const mine = (
			await call("POST", "/v1/setup/apps", key, { name: "web", platform: "javascript-nextjs" })
		).body?.data;
		expect(mine.project.platform).toBe("javascript-nextjs");
		const other = (
			await call("POST", "/v1/setup/apps", key, { name: "other", platform: "node-express" })
		).body?.data;
		const token = (
			await call("POST", "/v1/setup/tokens", key, {
				name: "Claude Code",
				project: mine.project.slug,
			})
		).body?.data.token;
		clock.advance(2 * 3_600_000); // the setup key expired
		expect(
			(
				await call("POST", `/v1/setup/apps/${mine.project.slug}/report`, token, {
					step: "sdk_installed",
				})
			).status,
		).toBe(204);
		expect(
			(
				await call("POST", `/v1/setup/apps/${mine.project.id}/report`, token, {
					step: "sdk_installed",
				})
			).status,
		).toBe(204);
		expect(
			(
				await call("POST", `/v1/setup/apps/${other.project.slug}/report`, token, {
					step: "sdk_installed",
				})
			).status,
		).toBe(403);
		expect(
			(await call("POST", "/v1/setup/apps/nope/report", token, { step: "sdk_installed" })).status,
		).toBe(403);
		expect((await call("POST", "/v1/setup/apps", token, { name: "more" })).status).toBe(403);
		expect(
			(await call("POST", "/v1/setup/tokens", token, { name: "t", project: mine.project.slug }))
				.status,
		).toBe(403);
		expect(
			(await call("POST", `/v1/setup/apps/${mine.project.slug}/test-event`, token)).status,
		).toBe(404);
		expect((await call("GET", "/v1/setup/progress", token)).status).toBe(403);
	});

	it("a normal issues:write token (not from a setup key) cannot report", async () => {
		const { call, ports, newKey } = await setupApi();
		const key = await newKey();
		const app = (await call("POST", "/v1/setup/apps", key, { name: "web" })).body?.data;
		const { token } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "w",
			scopes: ["issues:write"],
		});
		expect(
			(
				await call("POST", `/v1/setup/apps/${app.project.slug}/report`, token, {
					step: "sdk_installed",
				})
			).status,
		).toBe(403);
	});
});
