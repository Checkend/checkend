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
