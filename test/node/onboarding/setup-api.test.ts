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
