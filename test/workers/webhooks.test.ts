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
			events: ["issue.new"],
			min_trust: "high",
			project: project.slug,
		});
		expect(created.kind).toBe("done");
		const raw = new TextEncoder().encode(JSON.stringify({ message: "d1 webhook" }));
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
});
