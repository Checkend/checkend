import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "tokens-api-admin-token-0123456789-abcdef";
const TOKEN = /ck_[A-Za-z0-9_-]{43}/;

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const app = createApp({ state: new IngestState() });
	const shop = await createProject(t.ports, { name: "Shop" });
	const blog = await createProject(t.ports, { name: "Blog" });
	const call = async (method: string, path: string, token: string | null, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: {
					...(token ? { authorization: `Bearer ${token}` } : {}),
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		const text = await response.text();
		return { status: response.status, text, body: text ? (JSON.parse(text) as any) : null };
	};
	return { ...t, shop, blog, call };
}

describe("POST /v1/tokens with a project", () => {
	it("binds the token to the app: deploys and source maps only for that app", async () => {
		const t = await setup();
		const created = await t.call("POST", "/v1/tokens", ADMIN, {
			name: "ci",
			scopes: ["releases:write"],
			project: t.shop.slug,
		});
		expect(created.status).toBe(201);
		expect(created.body.data).toMatchObject({
			name: "ci",
			scopes: ["releases:write"],
			project_id: t.shop.id,
			project_name: "Shop",
		});
		const token = created.body.data.token as string;
		expect(token).toMatch(TOKEN);
		const deploy = (project: number) =>
			t.call("POST", "/v1/deploys", token, { project, commit: "a1b2c3d", release: "1.0.0" });
		expect((await deploy(t.shop.id)).status).toBe(201);
		const other = await deploy(t.blog.id);
		expect(other.status).toBe(403);
		expect(other.body).toMatchObject({ error: "forbidden_project" });
		const row = await t.ports.db.first<{ project_id: number }>(
			sql`SELECT project_id FROM tokens WHERE name = 'ci'`,
		);
		expect(row?.project_id).toBe(t.shop.internalId);
		// The list shows the app, never the token.
		const list = await t.call("GET", "/v1/tokens", ADMIN);
		expect(list.body.data[0]).toMatchObject({ project_id: t.shop.id, project_name: "Shop" });
		expect(list.text).not.toMatch(TOKEN);
	});

	it("accepts the public ID too; without a project the token is for all apps", async () => {
		const t = await setup();
		const byId = await t.call("POST", "/v1/tokens", ADMIN, {
			name: "by-id",
			scopes: ["issues:read"],
			project: t.shop.id,
		});
		expect(byId.status).toBe(201);
		expect(byId.body.data.project_id).toBe(t.shop.id);
		const all = await t.call("POST", "/v1/tokens", ADMIN, { name: "all", scopes: ["issues:read"] });
		expect(all.status).toBe(201);
		expect(all.body.data).toMatchObject({ project_id: null, project_name: null });
	});

	it("an unknown project gives 404 project_not_found, and makes no token", async () => {
		const t = await setup();
		for (const project of ["no-such-app", 9999999999]) {
			const response = await t.call("POST", "/v1/tokens", ADMIN, {
				name: "x",
				scopes: ["issues:read"],
				project,
			});
			expect(response.status, String(project)).toBe(404);
			expect(response.body).toEqual({ error: "project_not_found" });
		}
		const invalid = await t.call("POST", "/v1/tokens", ADMIN, {
			name: "x",
			scopes: ["issues:read"],
			project: { id: 1 },
		});
		expect(invalid.status).toBe(400);
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM tokens`)).toBe(null);
	});

	it("still needs the admin scope", async () => {
		const t = await setup();
		const reader = (
			await t.call("POST", "/v1/tokens", ADMIN, { name: "r", scopes: ["issues:read"] })
		).body.data.token as string;
		const response = await t.call("POST", "/v1/tokens", reader, {
			name: "x",
			scopes: ["issues:read"],
			project: t.shop.slug,
		});
		expect(response.status).toBe(403);
	});
});

describe("GET /v1/tokens/current", () => {
	it("a bound token: its own fields and app, never the token or its hash", async () => {
		const t = await setup();
		const created = (
			await t.call("POST", "/v1/tokens", ADMIN, {
				name: "ci",
				scopes: ["releases:write"],
				project: t.shop.slug,
			})
		).body.data;
		const me = await t.call("GET", "/v1/tokens/current", created.token);
		expect(me.status).toBe(200);
		expect(me.body).toEqual({
			data: {
				type: "token",
				id: created.id,
				name: "ci",
				scopes: ["releases:write"],
				prefix: created.prefix,
				project_id: t.shop.id,
				project_name: "Shop",
			},
		});
		expect(me.text).not.toContain(created.token);
		const hash = await t.ports.db.first<{ token_hash: string }>(
			sql`SELECT token_hash FROM tokens WHERE id = ${created.id}`,
		);
		expect(me.text).not.toContain(hash?.token_hash);
	});

	it("an unbound token: project_id and project_name are null; no scope is needed", async () => {
		const t = await setup();
		const created = (
			await t.call("POST", "/v1/tokens", ADMIN, { name: "writer", scopes: ["issues:write"] })
		).body.data;
		const me = await t.call("GET", "/v1/tokens/current", created.token);
		expect(me.status).toBe(200);
		expect(me.body.data).toMatchObject({
			type: "token",
			name: "writer",
			scopes: ["issues:write"],
			project_id: null,
			project_name: null,
		});
	});

	it("the bootstrap ADMIN_TOKEN: type admin_token, all scopes, no ID or prefix", async () => {
		const t = await setup();
		const me = await t.call("GET", "/v1/tokens/current", ADMIN);
		expect(me.status).toBe(200);
		expect(me.body).toEqual({
			data: {
				type: "admin_token",
				id: null,
				name: "ADMIN_TOKEN",
				scopes: ["admin"],
				prefix: null,
				project_id: null,
				project_name: null,
			},
		});
		expect(me.text).not.toContain(ADMIN);
	});

	it("no token, a wrong token or a revoked token: 401", async () => {
		const t = await setup();
		expect((await t.call("GET", "/v1/tokens/current", null)).status).toBe(401);
		expect(
			(await t.call("GET", "/v1/tokens/current", "ck_testwrongtestwrongtestwrongtestwrongtestwr"))
				.status,
		).toBe(401);
		const created = (
			await t.call("POST", "/v1/tokens", ADMIN, { name: "r", scopes: ["issues:read"] })
		).body.data;
		expect((await t.call("DELETE", `/v1/tokens/${created.id}`, ADMIN)).status).toBe(204);
		expect((await t.call("GET", "/v1/tokens/current", created.token)).status).toBe(401);
	});

	it("the OpenAPI document says: a bearer token, no scope", async () => {
		const t = await setup();
		const spec = await t.call("GET", "/v1/openapi.json", null);
		const op = spec.body.paths["/v1/tokens/current"].get;
		expect(op.security).toEqual([{ bearer: [] }]);
		expect(op["x-required-scope"]).toBeUndefined();
	});
});
