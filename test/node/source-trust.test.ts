import { describe, expect, it } from "vitest";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { buildBrief } from "../../src/core/brief.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { getIssue } from "../../src/core/issues.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { createProject, listProjects } from "../../src/core/projects.ts";
import {
	classifySource,
	EFFECTIVE_TRUST_SQL,
	effectiveTrust,
	sourceOf,
	TRUST_WINDOW_MS,
	trustCutoff,
} from "../../src/core/trust.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { loadSentryFixtures } from "../fixtures/sentry/load.ts";
import { withKey } from "../fixtures/sentry/with-key.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "source-trust-admin-token-0123456789";
const DAY = 86_400_000;
// The webhook gate expression alone (SQL text from constants; its parameter is bound).
const GATE_SQL = `SELECT ${EFFECTIVE_TRUST_SQL("p")} AS trust FROM projects p`;

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	/** A Sentry store event with an SDK name (or none), from a browser when origin is set. */
	const send = async (sdkName: string | null, origin?: string, message = "cart total failed") => {
		const response = await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
				body: JSON.stringify({
					message,
					...(sdkName === null ? {} : { sdk: { name: sdkName, version: "1.0.0" } }),
				}),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return response.status;
	};
	const sendNative = async (message = "job failed") => {
		const response = await app.request(
			`https://checkend.test/v1/ingest?project=${project.id}`,
			{
				method: "POST",
				headers: { "content-type": "application/json", "x-checkend-key": project.publicKey },
				body: JSON.stringify({ type: "JobError", message }),
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
	const projectJson = async () => (await call("GET", "/v1/projects")).body.data[0];
	return { ...t, project, send, sendNative, call, projectJson };
}

describe("classifySource", () => {
	it("server SDKs and their integrations are server", () => {
		for (const name of [
			"sentry.python.django",
			"sentry.ruby.rails",
			"sentry.php.laravel",
			"sentry.java.spring-boot.jakarta",
			"sentry.dotnet.aspnetcore",
			"sentry.javascript.bun",
			"sentry.javascript.aws-serverless",
			"sentry.elixir",
			"sentry.rust",
		]) {
			expect(classifySource(name, { origin: false, native: false }), name).toBe("server");
		}
	});

	it("browser, mobile, desktop and unknown SDKs are client (fail closed)", () => {
		for (const name of [
			"sentry.javascript.react",
			"sentry.javascript.vue",
			"sentry.javascript.react-native",
			"sentry.cocoa",
			"sentry.java.android",
			"sentry.dart.flutter",
			"sentry.dotnet.maui",
			"sentry.dotnet.unity",
			"sentry.native",
			"sentry.electron",
			"my-own-client",
			"SENTRY.PYTHON",
			" sentry.python",
			"sentry.python ",
			"sentry.pythonx",
			"",
			null,
		]) {
			expect(classifySource(name, { origin: false, native: false }), String(name)).toBe("client");
		}
	});

	it("an Origin header is always client: the name can only lower trust", () => {
		expect(classifySource("sentry.python", { origin: true, native: false })).toBe("client");
		expect(classifySource(null, { origin: true, native: true })).toBe("client");
	});

	it("framework SDKs with a browser and a server part: the platform or runtime decides", () => {
		for (const name of [
			"sentry.javascript.nextjs",
			"sentry.javascript.sveltekit",
			"sentry.javascript.remix",
			"sentry.javascript.nuxt",
			"sentry.javascript.astro",
		]) {
			const as = (platform: string | null, runtime: string | null = null, origin = false) =>
				classifySource(name, { origin, native: false, platform, runtime });
			// The server part.
			expect(as("node"), name).toBe("server");
			expect(as("javascript", "vercel-edge"), name).toBe("server");
			expect(as("javascript", "bun"), name).toBe("server");
			// The browser part, also through a tunnel route (no Origin header): fail closed.
			expect(as("javascript"), name).toBe("client");
			expect(as(null), name).toBe("client");
			expect(as("Node"), name).toBe("client");
			expect(as("javascript", "chrome"), name).toBe("client");
			expect(as("node", "node", true), name).toBe("client");
		}
	});

	it("native ingest (X-Checkend-Key) is server", () => {
		expect(classifySource(null, { origin: false, native: true })).toBe("server");
	});
});

describe("source trust per app", () => {
	it("the golden fixtures: server SDKs are Server, the browser SDK is Browser", async () => {
		const sources: Record<string, unknown> = {};
		for (const fixture of loadSentryFixtures()) {
			const t = await testPorts();
			const project = await createProject(t.ports, { name: fixture.name });
			const app = createApp({ state: new IngestState() });
			const response = await app.request(
				`https://checkend.test/api/${project.id}/envelope/?sentry_key=${project.publicKey}`,
				{
					method: "POST",
					headers: withKey(fixture.headers, project.publicKey),
					body: fixture.body,
				},
				{ ports: t.ports },
			);
			await t.settle();
			expect(response.status, fixture.name).toBe(200);
			const [summary] = await listProjects(t.ports.db, t.clock.now());
			sources[fixture.sdk] = summary?.source;
		}
		expect(sources).toEqual({
			"@sentry/browser": "browser",
			"@sentry/node": "server",
			"sentry.dotnet": "server",
			"sentry.go": "server",
			"sentry.php": "server",
			"sentry.python": "server",
			"sentry.ruby": "server",
		});
	});

	it("a server SDK only: Server, high trust", async () => {
		const { send, projectJson, clock } = await setup();
		expect(await send("sentry.python")).toBe(200);
		expect(await projectJson()).toMatchObject({
			trust: "high",
			source_trust: "high",
			trust_setting: null,
			source: "server",
			server_seen_at: clock.now().toISOString(),
			client_seen_at: null,
		});
	});

	it("an app with no events: no source, high trust", async () => {
		const { projectJson } = await setup();
		expect(await projectJson()).toMatchObject({
			trust: "high",
			source: null,
			source_trust: "high",
		});
	});

	it("a browser SDK without an Origin header (a tunnel): Browser, low trust", async () => {
		const { send, projectJson } = await setup();
		await send("sentry.javascript.browser");
		expect(await projectJson()).toMatchObject({ trust: "low", source: "browser" });
	});

	it("a missing SDK name on a Sentry endpoint: low trust (fail closed)", async () => {
		const { send, projectJson } = await setup();
		await send(null);
		expect(await projectJson()).toMatchObject({ trust: "low", source: "browser" });
	});

	it("native ingest: Server, high trust", async () => {
		const { sendNative, projectJson } = await setup();
		expect(await sendNative()).toBe(200);
		expect(await projectJson()).toMatchObject({ trust: "high", source: "server" });
	});

	it("server and browser events: Mixed, low trust (the weakest source)", async () => {
		const { send, projectJson, call } = await setup();
		await send("sentry.python");
		await send("sentry.javascript.react", "https://shop.example", "a browser error");
		expect(await projectJson()).toMatchObject({
			trust: "low",
			source_trust: "low",
			source: "mixed",
		});
		const issues: { trust: string; source: string; source_trust: string }[] = (
			await call("GET", "/v1/issues")
		).body.data;
		expect(issues.map((i) => [i.trust, i.source, i.source_trust])).toEqual([
			["low", "mixed", "low"],
			["low", "mixed", "low"],
		]);
	});

	it("the admin setting wins; source_trust always equals trust", async () => {
		const { send, call, project } = await setup();
		await send("sentry.javascript.browser", "https://shop.example");
		const high = await call("PATCH", `/v1/projects/${project.slug}`, { trust: "high" });
		expect(high.body.data).toMatchObject({
			trust: "high",
			source_trust: "high",
			trust_setting: "high",
			source: "browser",
		});
	});

	it("a client source counts for 30 days: low at exactly 30 days, high 1 ms later", async () => {
		const { send, projectJson, clock } = await setup();
		await send("sentry.python");
		await send("sentry.javascript.browser", "https://shop.example", "browser");
		clock.advance(TRUST_WINDOW_MS);
		expect(await projectJson()).toMatchObject({ trust: "low", source: "mixed" });
		clock.advance(1);
		expect(await projectJson()).toMatchObject({ trust: "high", source: null });
		await send("sentry.python");
		expect(await projectJson()).toMatchObject({ trust: "high", source: "server" });
	});

	it("the seen time is written at most once an hour per source (idempotent, few writes)", async () => {
		const { send, projectJson, clock } = await setup();
		const first = clock.now().toISOString();
		await send("sentry.python");
		clock.advance(30 * 60_000);
		await send("sentry.python");
		await send("sentry.python");
		expect((await projectJson()).server_seen_at).toBe(first);
		clock.advance(31 * 60_000);
		await send("sentry.python");
		expect((await projectJson()).server_seen_at).toBe(clock.now().toISOString());
	});
});

describe("one effective trust everywhere", () => {
	it("the SQL gate, the JS function, /v1, the issue, the brief and MCP agree", async () => {
		const t = await setup();
		await t.send("sentry.python");
		const issueId = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))
			?.id as number;
		const now = t.clock.now();
		const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
		const cases = [
			{ trust: null, server_seen_at: ago(DAY), client_seen_at: null },
			{ trust: null, server_seen_at: null, client_seen_at: ago(DAY) },
			{ trust: null, server_seen_at: ago(DAY), client_seen_at: ago(TRUST_WINDOW_MS) },
			{ trust: null, server_seen_at: ago(DAY), client_seen_at: ago(TRUST_WINDOW_MS + 1) },
			{ trust: "high", server_seen_at: null, client_seen_at: ago(DAY) },
			{ trust: "low", server_seen_at: ago(DAY), client_seen_at: null },
			{ trust: null, server_seen_at: null, client_seen_at: null },
		] as const;
		for (const c of cases) {
			const label = JSON.stringify(c);
			await t.ports.db.run(
				sql`UPDATE projects SET trust = ${c.trust}, server_seen_at = ${c.server_seen_at},
					client_seen_at = ${c.client_seen_at}, browser_seen_at = NULL`,
			);
			const expected = effectiveTrust(c, now);
			const gate = await t.ports.db.first<{ trust: string }>({
				sql: GATE_SQL,
				params: [trustCutoff(now)],
			});
			expect(gate?.trust, `sql ${label}`).toBe(expected);
			const [project] = await listProjects(t.ports.db, now);
			expect(project?.trust, `project ${label}`).toBe(expected);
			expect(project?.source, `source ${label}`).toBe(sourceOf(c, now));
			expect((await t.projectJson()).trust, `/v1/projects ${label}`).toBe(expected);
			const issue = await getIssue(t.ports.db, issueId, now);
			expect(issue?.trust, `issue ${label}`).toBe(expected);
			expect(issue?.source_trust, `issue ${label}`).toBe(expected);
			const brief = await buildBrief(t.ports.db, issueId, now);
			expect(brief?.json.issue.trust, `brief ${label}`).toBe(expected);
			expect(brief?.json.issue.source_trust, `brief ${label}`).toBe(expected);
			expect(brief?.json.issue.source, `brief source ${label}`).toBe(sourceOf(c, now));
		}
	});
});

describe("migration 0032", () => {
	it("keeps an app with an old browser event low, with no scan of the events", async () => {
		const db = openSqliteDb(":memory:");
		const all = readMigrations("migrations");
		await applyMigrations(
			db,
			all.filter((m) => m.name < "0032"),
		);
		const seen = "2025-01-01T08:00:00.000Z"; // the first browser event, long ago
		await db.run(
			sql`INSERT INTO projects (name, slug, created_at, public_id, browser_seen_at)
				VALUES (${"Web"}, ${"web"}, ${seen}, ${1234567890}, ${seen}),
					(${"Api"}, ${"api"}, ${seen}, ${1234567891}, ${null})`,
		);
		const before = new Date();
		await applyMigrations(db, all);
		const after = new Date();
		const rows = await db.all<{
			slug: string;
			trust: string | null;
			client_seen_at: string | null;
			server_seen_at: string | null;
		}>(sql`SELECT slug, trust, client_seen_at, server_seen_at FROM projects ORDER BY id`);
		// The first browser event was long ago: the app stays low for 30 days from the migration
		// (the migration time, in the format of toISOString()), then follows the window.
		const web = rows[0];
		expect(web?.client_seen_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
		expect(Date.parse(web?.client_seen_at ?? "")).toBeGreaterThanOrEqual(before.getTime() - 1000);
		expect(Date.parse(web?.client_seen_at ?? "")).toBeLessThanOrEqual(after.getTime() + 1000);
		expect(web?.server_seen_at).toBeNull();
		if (!web) throw new Error("no row");
		expect(effectiveTrust(web, after)).toBe("low");
		expect(effectiveTrust(web, new Date(after.getTime() + TRUST_WINDOW_MS - 60_000))).toBe("low");
		expect(rows[1]).toMatchObject({ slug: "api", client_seen_at: null, server_seen_at: null });
	});
});
