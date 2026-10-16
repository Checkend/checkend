import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { storeEvent } from "../../src/core/ingest/store.ts";
import { deleteProject, runProjectPurge } from "../../src/core/project-delete.ts";
import { createProject } from "../../src/core/projects.ts";
import { runRetention } from "../../src/core/retention.ts";
import { eventSeries, MINUTE_COUNT_HOURS } from "../../src/core/series.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

/**
 * Events over time for the dashboard chart: per minute (Live, 60 minutes) from minute_counts,
 * per hour (24 hours, 7 days) from issue_counts.
 */
async function setup() {
	const t = await testPorts();
	const shop = await createProject(t.ports, { name: "Shop" });
	const blog = await createProject(t.ports, { name: "Blog" });
	const state = new IngestState();
	const send = async (
		project: typeof shop,
		body: object = { message: `boom ${Math.random()}` },
	) => {
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(body)),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
	};
	const minutes = () =>
		t.ports.db.all<{ minute: string; count: number }>(
			sql`SELECT minute, count FROM minute_counts ORDER BY minute, count`,
		);
	return { ...t, shop, blog, send, minutes };
}

describe("minute counts", () => {
	it("counts each stored event once per app and minute (a repeated event ID is not counted)", async () => {
		const { send, shop, blog, minutes, ports } = await setup();
		await send(shop);
		await send(shop);
		await send(blog);
		const same = { event_id: "a".repeat(32), message: "same" };
		await send(shop, same);
		await send(shop, same);
		expect(await minutes()).toEqual([
			{ minute: "2026-10-10T12:00", count: 1 },
			{ minute: "2026-10-10T12:00", count: 3 },
		]);
		const shopRow = await ports.db.first<{ count: number }>(
			sql`SELECT count FROM minute_counts WHERE project_id = ${shop.internalId}`,
		);
		expect(shopRow?.count).toBe(3);
	});

	it("keeps MINUTE_COUNT_HOURS of minutes (retention)", async () => {
		const { send, shop, clock, minutes, ports } = await setup();
		await send(shop);
		clock.advance(MINUTE_COUNT_HOURS * 3_600_000 + 60_000);
		await send(shop);
		await runRetention(ports, clock.now());
		expect((await minutes()).map((m) => m.minute)).toEqual(["2026-10-10T14:01"]);
	});

	it("goes with a deleted app (the purge)", async () => {
		const { send, shop, minutes, ports } = await setup();
		await send(shop);
		expect(await deleteProject(ports, BOOTSTRAP_ADMIN, String(shop.id))).toBe("deleted");
		while ((await runProjectPurge(ports, ports.clock.now())) > 0) {}
		expect(await minutes()).toEqual([]);
	});
});

describe("eventSeries", () => {
	it("live: the last 15 minutes, per minute, the oldest first", async () => {
		const { send, shop, clock, ports } = await setup();
		await send(shop);
		clock.advance(3 * 60_000);
		await send(shop);
		await send(shop);
		const series = await eventSeries(ports.db, clock.now(), "live");
		expect(series.unit).toBe("minute");
		expect(series.buckets).toHaveLength(15);
		expect(series.buckets.at(-1)).toEqual({ at: "2026-10-10T12:03", n: 2 });
		expect(series.buckets.at(-4)).toEqual({ at: "2026-10-10T12:00", n: 1 });
		expect(series.total).toBe(3);
	});

	it("1h: 60 minutes; 24h: 24 hours; 7d: 168 hours; and one app only", async () => {
		const { send, shop, blog, clock, ports } = await setup();
		await send(shop);
		await send(blog);
		clock.advance(2 * 3_600_000);
		await send(shop);
		const hour = await eventSeries(ports.db, clock.now(), "1h");
		expect(hour.buckets).toHaveLength(60);
		expect(hour.total).toBe(1);
		const day = await eventSeries(ports.db, clock.now(), "24h");
		expect(day.unit).toBe("hour");
		expect(day.buckets).toHaveLength(24);
		expect(day.total).toBe(3);
		expect(day.buckets.at(-1)).toEqual({ at: "2026-10-10T14", n: 1 });
		expect(day.buckets.at(-3)).toEqual({ at: "2026-10-10T12", n: 2 });
		const week = await eventSeries(ports.db, clock.now(), "7d", shop.id);
		expect(week.buckets).toHaveLength(168);
		expect(week.total).toBe(2);
		expect((await eventSeries(ports.db, clock.now(), "1h", blog.id)).total).toBe(0);
	});
});
