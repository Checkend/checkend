import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "tokens-api-bootstrap-admin-0123";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, token: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		const text = await response.text();
		return { status: response.status, body: text ? JSON.parse(text) : null };
	};
	const newToken = async (scopes: string[]) =>
		(await call("POST", "/v1/tokens", ADMIN, { name: `t-${scopes.join("-")}`, scopes })).body.data;
	return { ...t, call, newToken };
}

describe("tokens API", () => {
	it("creates a token (shown once), lists tokens without it, and revokes it", async () => {
		const { call } = await setup();
		const created = await call("POST", "/v1/tokens", ADMIN, {
			name: "claude-code",
			scopes: ["issues:read"],
		});
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({
			name: "claude-code",
			scopes: ["issues:read"],
			token: expect.stringMatching(/^ck_/),
		});
		const list = await call("GET", "/v1/tokens", ADMIN);
		expect(list.body.data).toHaveLength(1);
		expect(JSON.stringify(list.body)).not.toContain(created.body.data.token);
		expect((await call("GET", "/v1/issues", created.body.data.token)).status).toBe(200);
		expect((await call("DELETE", `/v1/tokens/${created.body.data.id}`, ADMIN)).status).toBe(204);
		expect((await call("GET", "/v1/issues", created.body.data.token)).status).toBe(401);
		expect((await call("DELETE", `/v1/tokens/${created.body.data.id}`, ADMIN)).status).toBe(404);
	});

	it("rejects invalid token input with 400", async () => {
		const { call } = await setup();
		expect((await call("POST", "/v1/tokens", ADMIN, { name: "x", scopes: ["root"] })).status).toBe(
			400,
		);
		expect(
			(await call("POST", "/v1/tokens", ADMIN, { name: "", scopes: ["issues:read"] })).status,
		).toBe(400);
		expect((await call("POST", "/v1/tokens", ADMIN, { name: "x" })).status).toBe(400);
	});
});

describe("scopes on the API", () => {
	it.each([
		["GET", "/v1/issues", "issues:read"],
		["GET", "/v1/projects", "issues:read"],
		["POST", "/v1/projects", "admin"],
		["GET", "/v1/tokens", "admin"],
		["POST", "/v1/tokens", "admin"],
		["GET", "/v1/activity", "admin"],
	])("%s %s needs %s", async (method, path, scope) => {
		const { call, newToken } = await setup();
		const body = method === "POST" ? { name: "x", scopes: ["issues:read"] } : undefined;
		const other =
			scope === "admin" ? ["issues:read", "issues:write", "releases:write"] : ["releases:write"];
		const without = await newToken(other);
		const denied = await call(method, path, without.token, body);
		expect(denied.status).toBe(403);
		expect(denied.body).toEqual({ error: "forbidden", required_scope: scope });
		const allowed = await newToken([scope]);
		expect([200, 201]).toContain((await call(method, path, allowed.token, body)).status);
	});
});

describe("activity API", () => {
	it("shows project and token writes with their actors, newest first", async () => {
		const { call, newToken } = await setup();
		const admin = await newToken(["admin"]);
		const project = (await call("POST", "/v1/projects", admin.token, { name: "Shop" })).body.data;
		const activity = (await call("GET", "/v1/activity?limit=10", ADMIN)).body.data;
		expect(
			activity.map((a: Record<string, unknown>) => [
				a.action,
				a.actor_type,
				a.actor_name,
				a.target_type,
				a.target_id,
			]),
		).toEqual([
			["project.create", "token", admin.name, "project", project.id],
			["token.create", "admin_token", "ADMIN_TOKEN", "token", admin.id],
		]);
		expect(activity[0].data).toEqual({ name: "Shop", slug: "shop", platform: null });
	});
});
