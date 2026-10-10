import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { RETENTION_CHUNK, runRetention } from "../../src/core/retention.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

async function setup(retentionDays = 30) {
	const t = await testPorts({ config: { retentionDays, eventsPerIssue: 1000 } });
	const project = await createProject(t.ports, { name: "Shop" });
	const store = async (message: string) => {
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify({ message })),
			t.clock.now(),
		);
		await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
	};
	const queries = {
		events: sql`SELECT count(*) AS n FROM events`,
		webhooks: sql`SELECT count(*) AS n FROM webhooks`,
	};
	const count = async (table: keyof typeof queries) =>
		(await t.ports.db.first<{ n: number }>(queries[table]))?.n;
	return { ...t, project, store, count };
}

describe("retention", () => {
	it("deletes events and hourly counts older than RETENTION_DAYS, and keeps the issues", async () => {
		const { store, clock, ports, count } = await setup(30);
		await store("old error");
		await store("old error");
		clock.advance(31 * 86_400_000);
		await store("old error");
		await store("new error");
		await runRetention(ports, clock.now());
		expect(await count("events")).toBe(2);
		expect(
			await ports.db.all(sql`SELECT title, times_seen, stored_events FROM issues ORDER BY title`),
		).toEqual([
			{ title: "new error", times_seen: 1, stored_events: 1 },
			{ title: "old error", times_seen: 3, stored_events: 1 },
		]);
		const hours = await ports.db.all<{ hour: string }>(sql`SELECT DISTINCT hour FROM issue_counts`);
		expect(hours.map((h) => h.hour)).toEqual(["2026-11-10T12"]);
	});

	it("deletes in chunks: a run stops after a few chunks, the next run goes on", async () => {
		const { store, clock, ports, count } = await setup(1);
		const total = RETENTION_CHUNK * 3 + 7;
		for (let i = 0; i < total; i++) await store(`error ${String.fromCharCode(97 + (i % 26))}`);
		clock.advance(2 * 86_400_000);
		const first = await runRetention(ports, clock.now(), { maxChunks: 2 });
		expect(first.events).toBe(RETENTION_CHUNK * 2);
		expect(await count("events")).toBe(total - RETENTION_CHUNK * 2);
		await runRetention(ports, clock.now(), { maxChunks: 2 });
		expect(await count("events")).toBe(0);
		expect(await ports.db.first(sql`SELECT max(stored_events) AS n FROM issues`)).toEqual({ n: 0 });
	});

	it("deletes finished webhook deliveries after 30 days, and keeps pending ones", async () => {
		const { ports, clock, count } = await setup(365);
		const now = clock.now().toISOString();
		await ports.db.batch([
			sql`INSERT INTO webhooks (uid, name, url, secret, events, created_at, created_by)
				VALUES ('u', 'w', 'https://x', 'enc1:k:a:b', '[]', ${now}, 'admin')`,
			sql`INSERT INTO webhook_deliveries (webhook_id, event, status, next_attempt_at, created_at)
				VALUES (1, 'ping', 'delivered', ${now}, ${now}), (1, 'ping', 'failed', ${now}, ${now}),
					(1, 'ping', 'pending', ${now}, ${now})`,
		]);
		clock.advance(31 * 86_400_000);
		await runRetention(ports, clock.now());
		expect(await ports.db.all(sql`SELECT status FROM webhook_deliveries`)).toEqual([
			{ status: "pending" },
		]);
		expect(await count("webhooks")).toBe(1);
	});

	it("runs from the cron", async () => {
		const { store, clock, ports, count } = await setup(1);
		await store("x");
		clock.advance(2 * 86_400_000);
		const { runScheduled } = await import("../../src/core/scheduler.ts");
		await runScheduled(ports, clock.now());
		expect(await count("events")).toBe(0);
	});
});
