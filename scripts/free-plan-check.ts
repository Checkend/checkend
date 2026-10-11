// The full-flow check of a deployed Checkend (for example on a Workers Free account). A person
// runs it after a deploy; it uses only the public API, MCP and ingest. Checklist and the parts
// that only the Cloudflare dashboard shows: scripts/free-plan-check.md.
//
//   CHECKEND_URL=https://<worker>.workers.dev CHECKEND_ADMIN_TOKEN=... node scripts/free-plan-check.ts
//
// It creates a project "free-plan-check-<time>", and deletes it at the end.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSentryFixture } from "../test/fixtures/sentry/load.ts";
import { withKey } from "../test/fixtures/sentry/with-key.ts";

export interface StepResult {
	step: string;
	ok: boolean;
	detail: string;
}

type Json = Record<string, any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs the steps in order; it stops at the first failure (later steps need the earlier ones). */
export async function freePlanCheck(options: {
	url: string;
	adminToken: string;
	/** Waits for asynchronous work (ingest writes, key cache). */
	waitMs?: number;
	fetch?: typeof fetch;
}): Promise<StepResult[]> {
	const base = options.url.replace(/\/+$/, "");
	const doFetch = options.fetch ?? fetch;
	const waitMs = options.waitMs ?? 65_000;
	const results: StepResult[] = [];
	const call = async (method: string, path: string, token: string | null, body?: unknown) => {
		const response = await doFetch(`${base}${path}`, {
			method,
			headers: {
				...(token ? { authorization: `Bearer ${token}` } : {}),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
		const text = await response.text();
		let json: Json = {};
		try {
			json = text ? (JSON.parse(text) as Json) : {};
		} catch {
			json = { text };
		}
		return { status: response.status, json };
	};
	const until = async <T>(check: () => Promise<T | null>, ms: number): Promise<T | null> => {
		const end = Date.now() + ms;
		for (;;) {
			const value = await check();
			if (value !== null || Date.now() > end) return value;
			await sleep(1000);
		}
	};
	const step = async (name: string, run: () => Promise<string>) => {
		try {
			results.push({ step: name, ok: true, detail: await run() });
			return true;
		} catch (error) {
			results.push({
				step: name,
				ok: false,
				detail: error instanceof Error ? error.message : String(error),
			});
			return false;
		}
	};
	const expectStatus = (what: string, got: { status: number; json: Json }, want: number) => {
		if (got.status !== want)
			throw new Error(`${what}: HTTP ${got.status} ${JSON.stringify(got.json).slice(0, 200)}`);
	};
	const admin = options.adminToken;
	const ctx: Json = {};

	const steps: [string, () => Promise<string>][] = [
		[
			"health",
			async () => {
				const health = await call("GET", "/health", null);
				expectStatus("GET /health", health, 200);
				return `status ${health.json.status}, migrations ${health.json.migrations?.latest}`;
			},
		],
		[
			"setup key and app",
			async () => {
				const key = await call("POST", "/v1/setup/keys", admin);
				expectStatus("POST /v1/setup/keys", key, 201);
				ctx.setupKey = key.json.data.key;
				const app = await call("POST", "/v1/setup/apps", ctx.setupKey, {
					name: `free-plan-check-${Date.now()}`,
					platform: "node",
				});
				expectStatus("POST /v1/setup/apps", app, 201);
				ctx.project = app.json.data.project;
				ctx.dsn = new URL(app.json.data.dsn);
				return `project ${ctx.project.id} (${ctx.project.slug})`;
			},
		],
		[
			"agent token and test event",
			async () => {
				const token = await call("POST", "/v1/setup/tokens", ctx.setupKey, {
					name: "free-plan-check",
					project: ctx.project.slug,
				});
				expectStatus("POST /v1/setup/tokens", token, 201);
				ctx.agent = token.json.data.token;
				expectStatus(
					"test event",
					await call("POST", `/v1/setup/apps/${ctx.project.slug}/test-event`, ctx.setupKey),
					202,
				);
				expectStatus(
					"report",
					await call("POST", `/v1/setup/apps/${ctx.project.slug}/report`, ctx.agent, {
						step: "sdk_installed",
					}),
					204,
				);
				return "token made, test event sent, SDK reported";
			},
		],
		[
			"SDK event to issue",
			async () => {
				const fixture = loadSentryFixture("node-type-error");
				const key = ctx.dsn.username as string;
				const sent = await doFetch(`${base}/api/${ctx.project.id}/envelope/?sentry_key=${key}`, {
					method: "POST",
					headers: withKey(fixture.headers, key),
					body: fixture.body,
				});
				if (sent.status !== 200) throw new Error(`ingest: HTTP ${sent.status}`);
				const issue = await until(async () => {
					const page = await call("GET", `/v1/issues?project=${ctx.project.id}`, ctx.agent);
					return page.json.data?.[0] ?? null;
				}, 30_000);
				if (!issue) throw new Error("no issue after 30 s");
				ctx.issue = issue;
				return `issue ${issue.id}: ${String(issue.title).slice(0, 60)}`;
			},
		],
		[
			"MCP brief",
			async () => {
				const mcp = (body: unknown) =>
					doFetch(`${base}/mcp`, {
						method: "POST",
						headers: {
							authorization: `Bearer ${ctx.agent}`,
							"content-type": "application/json",
							accept: "application/json, text/event-stream",
						},
						body: JSON.stringify(body),
					});
				await mcp({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-06-18",
						capabilities: {},
						clientInfo: { name: "free-plan-check", version: "1" },
					},
				});
				const response = await mcp({
					jsonrpc: "2.0",
					id: 2,
					method: "tools/call",
					params: { name: "get_issue_brief", arguments: { issue_id: ctx.issue.id } },
				});
				const text = await response.text();
				if (!text.includes("brief v1")) throw new Error(`no brief: ${text.slice(0, 200)}`);
				return "get_issue_brief returned brief v1";
			},
		],
		[
			"fix and deploy",
			async () => {
				const sha = "f".repeat(40);
				expectStatus(
					"link fix",
					await call("POST", `/v1/issues/${ctx.issue.id}/fix`, ctx.agent, { commit: sha }),
					200,
				);
				const deploy = await call("POST", "/v1/deploys", admin, {
					project: ctx.project.id,
					commit: sha,
					release: "check-1",
				});
				expectStatus("POST /v1/deploys", deploy, 201);
				if (!deploy.json.data.fixes_deployed?.includes(ctx.issue.id))
					throw new Error("the deploy did not contain the fix");
				return "fix linked; the deploy contains it (verified after the quiet period)";
			},
		],
		[
			"progress",
			async () => {
				const progress = await call("GET", "/v1/setup/progress", admin);
				expectStatus("GET /v1/setup/progress", progress, 200);
				const app = progress.json.data.apps.find((a: Json) => a.project.id === ctx.project.id);
				const missing = [
					"sdk_installed_at",
					"test_event_at",
					"first_event_at",
					"agent",
					"first_deploy_at",
				].filter((k) => !app?.[k]);
				if (missing.length > 0) throw new Error(`missing: ${missing.join(", ")}`);
				return "every setup step is recorded";
			},
		],
		[
			"delete and key stop",
			async () => {
				expectStatus(
					"DELETE project",
					await call("DELETE", `/v1/projects/${ctx.project.slug}`, admin),
					204,
				);
				const key = ctx.dsn.username as string;
				const stopped = await until(async () => {
					const r = await doFetch(`${base}/api/${ctx.project.id}/store/?sentry_key=${key}`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: '{"message":"after delete"}',
					});
					return r.status === 401 ? true : null;
				}, waitMs);
				if (!stopped) throw new Error("the DSN key still works");
				return "project deleted; its DSN key gets 401";
			},
		],
	];
	for (const [name, run] of steps) {
		if (!(await step(name, run))) break;
	}
	return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const url = process.env.CHECKEND_URL;
	const adminToken = process.env.CHECKEND_ADMIN_TOKEN;
	if (!url || !adminToken) {
		console.error("Set CHECKEND_URL and CHECKEND_ADMIN_TOKEN.");
		process.exit(2);
	}
	const results = await freePlanCheck({ url, adminToken });
	for (const r of results)
		console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.step.padEnd(28)} ${r.detail}`);
	process.exitCode = results.length === 8 && results.every((r) => r.ok) ? 0 : 1;
}
