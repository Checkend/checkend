import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { TRIAGE_QUESTIONS } from "../../src/core/ai/triage.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { storeEvent } from "../../src/core/ingest/store.ts";
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
	return { ...t, app, shop, blog, call };
}

/** Shop has one issue, Blog two; `shopToken` is bound to Shop and has issues:write. */
async function issueSetup() {
	const t = await setup();
	const store = async (projectRow: number, type: string) => {
		const raw = new TextEncoder().encode(
			JSON.stringify({ exception: { values: [{ type, value: `${type} happened` }] } }),
		);
		await storeEvent(
			t.ports,
			new IngestState(),
			projectRow,
			await prepareEvent(raw, t.clock.now()),
		);
	};
	await store(t.shop.internalId, "ShopError");
	await store(t.blog.internalId, "BlogError");
	await store(t.blog.internalId, "BlogOtherError");
	const issues = async (projectRow: number) =>
		(
			await t.ports.db.all<{ id: number }>(
				sql`SELECT id FROM issues WHERE project_id = ${projectRow} ORDER BY id`,
			)
		).map((row) => row.id);
	const [shopIssue] = (await issues(t.shop.internalId)) as [number];
	const [blogIssue, blogIssue2] = (await issues(t.blog.internalId)) as [number, number];
	const blogEvent = (
		await t.ports.db.first<{ id: number }>(
			sql`SELECT id FROM events WHERE issue_id = ${blogIssue} LIMIT 1`,
		)
	)?.id as number;
	const shopToken = (
		await t.call("POST", "/v1/tokens", ADMIN, {
			name: "shop-agent",
			scopes: ["issues:read", "issues:write"],
			project: t.shop.slug,
		})
	).body.data.token as string;
	const mcp = async (token: string) => {
		const client = new Client({ name: "tokens-project-test", version: "1.0.0" });
		await client.connect(
			new StreamableHTTPClientTransport(new URL("https://checkend.test/mcp"), {
				fetch: async (input, init) => {
					const request = new Request(input, init);
					request.headers.set("authorization", `Bearer ${token}`);
					return t.app.request(request, undefined, { ports: t.ports });
				},
			}),
		);
		return client;
	};
	const callTool = async (token: string, name: string, args: Record<string, unknown>) => {
		const client = await mcp(token);
		const result = (await client.callTool({ name, arguments: args })) as any;
		await client.close();
		return { isError: result.isError ?? false, text: String(result.content?.[0]?.text) };
	};
	// Issues, events and the activity log (notes, claims, fixes, triage corrections).
	const snapshot = async () => [
		await t.ports.db.all(sql`SELECT * FROM issues ORDER BY id`),
		await t.ports.db.all(sql`SELECT id, issue_id FROM events ORDER BY id`),
		await t.ports.db.all(sql`SELECT * FROM activity ORDER BY id`),
	];
	return { ...t, shopIssue, blogIssue, blogIssue2, blogEvent, shopToken, callTool, snapshot };
}

type IssueSetup = Awaited<ReturnType<typeof issueSetup>>;

const category = Object.keys(
	(TRIAGE_QUESTIONS.category as unknown as { criteria: Record<string, string> }).criteria,
)[0];

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

describe("a token bound to an app writes only the issues of that app", () => {
	const rest: [string, string, (s: IssueSetup) => [string, unknown?]][] = [
		["POST", "resolve", (s) => [`/v1/issues/${s.blogIssue}/resolve`]],
		["POST", "ignore", (s) => [`/v1/issues/${s.blogIssue}/ignore`]],
		["POST", "unresolve", (s) => [`/v1/issues/${s.blogIssue}/unresolve`]],
		["POST", "claim", (s) => [`/v1/issues/${s.blogIssue}/claim`, {}]],
		["POST", "release", (s) => [`/v1/issues/${s.blogIssue}/release`]],
		["DELETE", "claim", (s) => [`/v1/issues/${s.blogIssue}/claim`]],
		["POST", "notes", (s) => [`/v1/issues/${s.blogIssue}/notes`, { text: "a note" }]],
		["POST", "fix", (s) => [`/v1/issues/${s.blogIssue}/fix`, { commit: "a1b2c3d" }]],
		[
			"POST",
			"triage-correction",
			(s) => [`/v1/issues/${s.blogIssue}/triage-correction`, { category }],
		],
		["POST", "split", (s) => [`/v1/issues/${s.blogIssue}/split`, { event_ids: [s.blogEvent] }]],
		[
			"POST",
			"merge (Blog target)",
			(s) => [`/v1/issues/${s.blogIssue}/merge`, { source_ids: [s.blogIssue2] }],
		],
		[
			"POST",
			"merge (Shop target, Blog source)",
			(s) => [`/v1/issues/${s.shopIssue}/merge`, { source_ids: [s.blogIssue] }],
		],
	];
	for (const [method, name, make] of rest) {
		it(`REST ${method} ${name} on a Blog issue: 403 forbidden_project, and no change`, async () => {
			const s = await issueSetup();
			// A claim by another token, so that release has something to release.
			expect((await s.call("POST", `/v1/issues/${s.blogIssue}/claim`, ADMIN, {})).status).toBe(200);
			const before = await s.snapshot();
			const [path, body] = make(s);
			const response = await s.call(method, path, s.shopToken, body);
			expect(response.status).toBe(403);
			expect(response.body).toEqual({
				error: "forbidden_project",
				reason: "This token is for another app.",
			});
			expect(await s.snapshot()).toEqual(before);
		});
	}

	const mcp: [string, (s: IssueSetup) => Record<string, unknown>][] = [
		["resolve_issue", (s) => ({ issue_id: s.blogIssue })],
		["ignore_issue", (s) => ({ issue_id: s.blogIssue })],
		["claim_issue", (s) => ({ issue_id: s.blogIssue })],
		["release_claim", (s) => ({ issue_id: s.blogIssue })],
		["add_note", (s) => ({ issue_id: s.blogIssue, text: "a note" })],
		["link_fix", (s) => ({ issue_id: s.blogIssue, commit: "a1b2c3d" })],
		["correct_triage", (s) => ({ issue_id: s.blogIssue, category })],
		["split_issue", (s) => ({ issue_id: s.blogIssue, event_ids: [s.blogEvent] })],
		["merge_issues", (s) => ({ target_id: s.blogIssue, source_ids: [s.blogIssue2] })],
		["merge_issues", (s) => ({ target_id: s.shopIssue, source_ids: [s.blogIssue] })],
	];
	for (const [name, args] of mcp) {
		it(`MCP ${name} on a Blog issue: an error result forbidden_project, and no change`, async () => {
			const s = await issueSetup();
			expect((await s.call("POST", `/v1/issues/${s.blogIssue}/claim`, ADMIN, {})).status).toBe(200);
			const before = await s.snapshot();
			const result = await s.callTool(s.shopToken, name, args(s));
			expect(result).toEqual({
				isError: true,
				text: "forbidden_project: This token is for another app.",
			});
			expect(await s.snapshot()).toEqual(before);
		});
	}

	it("writes to its own app work, and reads of other apps stay open", async () => {
		const s = await issueSetup();
		expect((await s.call("POST", `/v1/issues/${s.shopIssue}/resolve`, s.shopToken)).status).toBe(
			200,
		);
		expect((await s.call("POST", `/v1/issues/${s.shopIssue}/claim`, s.shopToken, {})).status).toBe(
			200,
		);
		expect((await s.call("POST", `/v1/issues/${s.shopIssue}/release`, s.shopToken)).status).toBe(
			200,
		);
		expect(
			(await s.callTool(s.shopToken, "add_note", { issue_id: s.shopIssue, text: "ok" })).isError,
		).toBe(false);
		expect((await s.call("GET", `/v1/issues/${s.blogIssue}`, s.shopToken)).status).toBe(200);
		expect(
			(await s.callTool(s.shopToken, "get_issue_brief", { issue_id: s.blogIssue })).isError,
		).toBe(false);
	});

	it("an unknown issue stays 404 not_found, as for an unbound token", async () => {
		const s = await issueSetup();
		const unbound = (
			await s.call("POST", "/v1/tokens", ADMIN, {
				name: "all",
				scopes: ["issues:read", "issues:write"],
			})
		).body.data.token as string;
		for (const token of [s.shopToken, unbound]) {
			const response = await s.call("POST", "/v1/issues/999999/resolve", token);
			expect(response.status).toBe(404);
			expect(response.body).toEqual({ error: "not_found" });
			expect((await s.callTool(token, "resolve_issue", { issue_id: 999999 })).text).toBe(
				"Issue 999999 not found.",
			);
		}
	});

	it("an unbound token, ADMIN_TOKEN and the setup agent token: as before or bound", async () => {
		const s = await issueSetup();
		const unbound = (
			await s.call("POST", "/v1/tokens", ADMIN, {
				name: "all",
				scopes: ["issues:read", "issues:write"],
			})
		).body.data.token as string;
		expect((await s.call("POST", `/v1/issues/${s.blogIssue}/ignore`, unbound)).status).toBe(200);
		expect((await s.call("POST", `/v1/issues/${s.blogIssue}/resolve`, ADMIN)).status).toBe(200);
		// The setup agent token is bound to its app (POST /v1/setup/tokens): the same limit.
		const agent = (
			await s.call("POST", "/v1/setup/tokens", ADMIN, { name: "agent", project: s.shop.slug })
		).body.data.token as string;
		expect((await s.call("POST", `/v1/issues/${s.shopIssue}/ignore`, agent)).status).toBe(200);
		expect((await s.call("POST", `/v1/issues/${s.blogIssue}/ignore`, agent)).status).toBe(403);
	});
});
