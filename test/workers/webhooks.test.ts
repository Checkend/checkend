import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { createWebhook, deliverDue } from "../../src/core/webhooks.ts";
import type { Ports } from "../../src/ports/index.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("webhooks on D1", () => {
	it("adds a delivery in the ingest batch and sends it", async () => {
		const sent: string[] = [];
		const base = cloudflarePorts(env, createExecutionContext());
		const ports: Ports = {
			...base,
			resolver: { resolve: async () => ["93.184.216.34"] },
			http: {
				send: async (_url, init) => {
					sent.push(String(init.body));
					return new Response(null, { status: 200 });
				},
			},
			config: { ...base.config, encryptionKeys: [{ id: "k1", key: new Uint8Array(32).fill(7) }] },
		};
		const project = await createProject(ports, { name: "D1 webhooks" });
		const created = await createWebhook(ports, BOOTSTRAP_ADMIN, {
			name: "runner",
			url: "https://hooks.example/x",
			format: "checkend",
			events: ["issue.new"],
			min_trust: "high",
			project: project.slug,
		});
		expect(created.kind).toBe("done");
		// A server SDK: high trust, so the default webhook (min_trust high) gets it.
		const raw = new TextEncoder().encode(
			JSON.stringify({
				message: "d1 webhook",
				sdk: { name: "sentry.javascript.node", version: "8.0.0" },
			}),
		);
		const result = await storeEvent(
			ports,
			new IngestState(),
			project.internalId,
			await prepareEvent(raw, new Date()),
		);
		expect(result.deliveries).toBe(1);
		expect(await deliverDue(ports)).toBe(1);
		expect(JSON.parse(sent[0] ?? "{}")).toMatchObject({
			event: "issue.new",
			issue: { title_untrusted: "d1 webhook" },
		});
	});

	it("adds one spike delivery when the hourly count goes above the threshold (D1 SQL)", async () => {
		const base = cloudflarePorts(env, createExecutionContext());
		const ports: Ports = {
			...base,
			resolver: { resolve: async () => ["93.184.216.34"] },
			config: { ...base.config, encryptionKeys: [{ id: "k1", key: new Uint8Array(32).fill(7) }] },
		};
		const project = await createProject(ports, { name: "D1 spikes" });
		const created = await createWebhook(ports, BOOTSTRAP_ADMIN, {
			name: "spikes",
			url: "https://hooks.slack.com/services/T1/B1/abc",
			format: "slack",
			events: ["issue.spike"],
			spike_threshold: 2,
			min_trust: "high",
			project: project.slug,
		});
		expect(created.kind).toBe("done");
		const results = [];
		for (let i = 0; i < 4; i++) {
			const raw = new TextEncoder().encode(
				JSON.stringify({
					message: "d1 spike",
					sdk: { name: "sentry.javascript.node", version: "8.0.0" },
				}),
			);
			results.push(
				await storeEvent(
					ports,
					new IngestState(),
					project.internalId,
					await prepareEvent(raw, new Date()),
				),
			);
		}
		expect(results.map((r) => r.deliveries)).toEqual([0, 0, 1, 0]);
	});
});
