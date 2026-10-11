import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { freePlanCheck } from "../../scripts/free-plan-check.ts";
import { startServer } from "../../src/entry/server.ts";

describe("the full-flow check script", () => {
	it("passes every step against a running Checkend (the Node server)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "checkend-flow-"));
		const admin = "flow-check-admin-token-test-0123456789";
		const server = await startServer({
			DATABASE_PATH: join(dir, "checkend.sqlite"),
			PORT: "0",
			HOST: "127.0.0.1",
			ADMIN_TOKEN: admin,
		});
		try {
			const results = await freePlanCheck({ url: server.url, adminToken: admin, waitMs: 5000 });
			expect(results.filter((r) => !r.ok)).toEqual([]);
			expect(results.map((r) => r.step)).toEqual([
				"health",
				"setup key and app",
				"agent token and test event",
				"SDK event to issue",
				"MCP brief",
				"fix and deploy",
				"progress",
				"delete and key stop",
			]);
		} finally {
			await server.stop();
		}
	}, 60_000);

	it("stops at the first failure, with the reason", async () => {
		const results = await freePlanCheck({
			url: "https://checkend.example",
			adminToken: "x",
			fetch: (async () => new Response("down", { status: 503 })) as typeof fetch,
		});
		expect(results).toEqual([
			{ step: "health", ok: false, detail: expect.stringContaining("HTTP 503") },
		]);
	});
});
