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
		});
	});

	it("reads REQUIRE_APPROVAL: only ignore and merge", () => {
		expect(readConfig({ REQUIRE_APPROVAL: " ignore, merge ,delete" }).requireApproval).toEqual([
			"ignore",
			"merge",
		]);
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
});
