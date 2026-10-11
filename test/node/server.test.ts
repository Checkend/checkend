import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { enqueueEvent } from "../../src/core/ingest/overflow.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { type RunningServer, startServer } from "../../src/entry/server.ts";
import { sql } from "../../src/ports/db.ts";
import { loadSentryFixture } from "../fixtures/sentry/load.ts";
import { withKey } from "../fixtures/sentry/with-key.ts";

const ADMIN = "server-test-admin-token-0123456789";

const waitFor = async <T>(check: () => Promise<T | null | undefined>, ms = 10_000): Promise<T> => {
	const until = Date.now() + ms;
	while (Date.now() < until) {
		const value = await check();
		if (value) return value;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("timed out");
};

describe("Checkend on Node, without Cloudflare (the full flow)", () => {
	let server: RunningServer;
	const dir = mkdtempSync(join(tmpdir(), "checkend-server-"));
	const api = async (method: string, path: string, body?: unknown) => {
		const response = await fetch(`${server.url}${path}`, {
			method,
			headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};

	beforeAll(async () => {
		server = await startServer({
			DATABASE_PATH: join(dir, "checkend.sqlite"),
			BLOBS_DIR: join(dir, "blobs"),
			PORT: "0",
			HOST: "127.0.0.1",
			ADMIN_TOKEN: ADMIN,
		});
	});
	afterAll(async () => {
		await server.stop();
	});

	it("fails at start when the port is in use, and does not hang", async () => {
		const port = new URL(server.url).port;
		await expect(
			startServer({ DATABASE_PATH: ":memory:", PORT: port, HOST: "127.0.0.1", ADMIN_TOKEN: ADMIN }),
		).rejects.toThrow(/EADDRINUSE/);
	});

	it("has no models without a Cloudflare account and token, and has them with both", async () => {
		expect(server.ports.models).toBeNull();
		const withAi = await startServer({
			DATABASE_PATH: ":memory:",
			PORT: "0",
			HOST: "127.0.0.1",
			CLOUDFLARE_ACCOUNT_ID: "acc",
			CLOUDFLARE_API_TOKEN: "token",
		});
		expect(withAi.ports.models).not.toBeNull();
		await withAi.stop();
	});

	it("refuses SMTP credentials without TLS (smtp:// sends them in clear text)", async () => {
		const start = (url: string) =>
			startServer({
				DATABASE_PATH: ":memory:",
				PORT: "0",
				HOST: "127.0.0.1",
				SMTP_URL: url,
				EMAIL_FROM: "a@example.com",
			});
		await expect(start("smtp://user:secret@mail.example.com:587")).rejects.toThrow(/smtps:\/\//);
		const relay = await start("smtp://relay.example.com:25");
		expect(relay.ports.mailer).not.toBeNull();
		await relay.stop();
	});

	it("serves health with all migrations applied", async () => {
		const health = (await (await fetch(`${server.url}/health`)).json()) as Record<string, any>;
		expect(health).toMatchObject({
			status: "ok",
			migrations: { latest: expect.stringMatching(/\.sql$/) },
		});
	});

	it("takes a real SDK request, groups it, and serves it to the API and to MCP", async () => {
		const project = (await api("POST", "/v1/projects", { name: "Node shop" })).body.data;
		const dsn = new URL(project.dsn);
		const fixture = loadSentryFixture("node-type-error");
		const sent = await fetch(
			`${server.url}/api/${project.id}/envelope/?sentry_key=${dsn.username}`,
			{
				method: "POST",
				headers: withKey(fixture.headers, dsn.username),
				body: fixture.body,
			},
		);
		expect(sent.status).toBe(200);
		const issues = await waitFor(async () => {
			const page = (await api("GET", `/v1/issues?project=${project.id}`)).body.data;
			return page.length > 0 ? page : null;
		});
		expect(issues[0]).toMatchObject({ project_id: project.id, times_seen: 1 });

		const client = new Client({ name: "server-test", version: "1.0.0" });
		await client.connect(
			new StreamableHTTPClientTransport(new URL(`${server.url}/mcp`), {
				requestInit: { headers: { authorization: `Bearer ${ADMIN}` } },
			}),
		);
		const brief = await client.callTool({
			name: "get_issue_brief",
			arguments: { issue_id: issues[0].id },
		});
		const text = (brief.content as { text: string }[]).map((c) => c.text).join("");
		expect(text).toContain("(brief v1)");
		await client.close();
	});

	it("writes events from the jobs table (the queue of the Node runtime)", async () => {
		const project = (await api("POST", "/v1/projects", { name: "Queued" })).body.data;
		const row = await server.ports.db.first<{ id: number }>(
			sql`SELECT id FROM projects WHERE public_id = ${project.id}`,
		);
		const prepared = await prepareEvent(
			new TextEncoder().encode('{"message":"from the queue"}'),
			new Date(),
		);
		expect(await enqueueEvent(server.ports, row?.id ?? 0, prepared, false)).toBe(true);
		const issues = await waitFor(async () => {
			const page = (await api("GET", `/v1/issues?project=${project.id}`)).body.data;
			return page.length > 0 ? page : null;
		});
		expect(issues[0]).toMatchObject({ title: "from the queue" });
	});
});

describe("the server process", () => {
	it("stops on SIGTERM after it writes the events it accepted", async () => {
		const dir = mkdtempSync(join(tmpdir(), "checkend-process-"));
		const database = join(dir, "checkend.sqlite");
		const child = spawn(process.execPath, ["src/entry/server.ts"], {
			env: {
				...process.env,
				DATABASE_PATH: database,
				PORT: "0",
				HOST: "127.0.0.1",
				ADMIN_TOKEN: ADMIN,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString("utf8");
		});
		const url = await waitFor(async () => /"url":"([^"]+)"/.exec(output)?.[1], 20_000);
		const created = await fetch(`${url}/v1/projects`, {
			method: "POST",
			headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "Process" }),
		});
		const project = ((await created.json()) as { data: { id: number; dsn: string } }).data;
		const key = new URL(project.dsn).username;
		const response = await fetch(`${url}/api/${project.id}/store/?sentry_key=${key}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"message":"written before exit"}',
		});
		expect(response.status).toBe(200);
		child.kill("SIGTERM");
		const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
		expect(code).toBe(0);
		expect(output).toContain("SIGTERM, stopping");
		// The database was closed after the drain: the WAL is checkpointed into the main file.
		const wal = `${database}-wal`;
		expect(existsSync(wal) ? statSync(wal).size : 0).toBe(0);
		const db = openSqliteDb(database);
		expect(await db.first(sql`SELECT title FROM issues`)).toEqual({ title: "written before exit" });
	});
});
