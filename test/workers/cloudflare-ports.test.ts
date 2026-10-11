import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts, readConfig } from "../../src/adapters/cloudflare/ports.ts";
import { DEFAULT_CONFIG } from "../../src/ports/config.ts";

describe("readConfig", () => {
	it("uses the defaults when nothing is set", () => {
		expect(readConfig({})).toEqual(DEFAULT_CONFIG);
	});

	it("reads the admin token and numeric settings", () => {
		expect(
			readConfig({
				ADMIN_TOKEN: "  s3cret  ",
				D1_DAILY_ROW_LIMIT: "100000",
				EVENTS_PER_ISSUE: "20",
				NEW_ISSUES_PER_HOUR: "5",
				TAG_KEYS_PER_PROJECT: "10",
				VERIFY_QUIET_HOURS: "6",
			}),
		).toEqual({
			adminToken: "s3cret",
			dailyRowLimit: 100000,
			eventsPerIssue: 20,
			newIssuesPerHour: 5,
			tagKeysPerProject: 10,
			requireApproval: [],
			verifyQuietHours: 6,
			githubWebhookSecret: null,
			encryptionKeys: [],
			githubToken: null,
			retentionDays: 90,
			ai: { gatewayId: "default", gatewayLogs: false, triage: false, similar: false },
		});
	});

	it("reads the AI settings: everything off by default, flags only with on", () => {
		expect(
			readConfig({
				AI_GATEWAY_ID: " checkend ",
				AI_GATEWAY_LOGS: "on",
				AI_TRIAGE: "on",
				AI_SIMILAR: "yes",
			}).ai,
		).toEqual({ gatewayId: "checkend", gatewayLogs: true, triage: true, similar: false });
	});

	it("reads REQUIRE_APPROVAL: only ignore and merge", () => {
		expect(
			readConfig({ REQUIRE_APPROVAL: " ignore, merge ,delete, delete_project" }).requireApproval,
		).toEqual(["ignore", "merge", "delete_project"]);
	});

	it("ignores empty and invalid values", () => {
		expect(
			readConfig({ ADMIN_TOKEN: "", D1_DAILY_ROW_LIMIT: "lots", EVENTS_PER_ISSUE: "-1" }),
		).toEqual(DEFAULT_CONFIG);
	});
});

describe("cloudflarePorts", () => {
	it("defers work with ctx.waitUntil", async () => {
		const ctx = createExecutionContext();
		let done = false;
		cloudflarePorts(env, ctx).defer(
			new Promise<void>((resolve) =>
				setTimeout(() => {
					done = true;
					resolve();
				}, 10),
			),
		);
		await waitOnExecutionContext(ctx);
		expect(done).toBe(true);
	});

	it("uses the rate limit binding when it exists, and allows all requests without it", async () => {
		const ctx = createExecutionContext();
		expect(await cloudflarePorts(env, ctx).rateLimiter.allow("key")).toBe(true);
		const denying = { limit: async () => ({ success: false }) };
		const limited = cloudflarePorts({ ...env, INGEST_RATE_LIMITER: denying }, ctx);
		expect(await limited.rateLimiter.allow("key")).toBe(false);
		const { INGEST_RATE_LIMITER: _absent, ...withoutBinding } = env;
		const open = cloudflarePorts(withoutBinding, ctx);
		expect(await open.rateLimiter.allow("key")).toBe(true);
	});

	it("runs models through the gateway with the AI binding, and has no models without it", async () => {
		const ctx = createExecutionContext();
		expect(cloudflarePorts(env, ctx).models).toBeNull();
		const seen: unknown[] = [];
		const AI = {
			run: async (_model: string, _input: object, options: unknown) => {
				seen.push(options);
				return { ok: true };
			},
		};
		const ports = cloudflarePorts({ ...env, AI, AI_GATEWAY_ID: "gw1" }, ctx);
		expect(await ports.models?.run("@cf/cloudflare/clef-flash", {})).toEqual({ ok: true });
		expect(seen).toEqual([{ gateway: { id: "gw1", collectLog: false } }]);
	});

	it("uses the Vectorize binding when it exists", () => {
		const ctx = createExecutionContext();
		expect(cloudflarePorts(env, ctx).vectors).toBeNull();
		const VECTORIZE = {
			upsert: async () => ({}),
			query: async () => ({ matches: [] }),
			queryById: async () => ({ matches: [] }),
			deleteByIds: async () => ({}),
		};
		expect(cloudflarePorts({ ...env, VECTORIZE }, ctx).vectors).not.toBeNull();
	});
});
