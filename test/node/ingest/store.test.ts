import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { FINGERPRINT_VERSION } from "../../../src/core/ingest/fingerprint.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject } from "../../../src/core/projects.ts";
import type { Config } from "../../../src/ports/config.ts";
import { type Db, sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const noSleep = async () => {};

const errorEvent = (overrides: Record<string, unknown> = {}) => ({
	event_id: crypto.randomUUID().replace(/-/g, ""),
	level: "error",
	platform: "node",
	release: "app@1.0.0",
	exception: {
		values: [
			{
				type: "TypeError",
				value: "x is undefined",
				stacktrace: { frames: [{ module: "cart", function: "total", lineno: 3, in_app: true }] },
			},
		],
	},
	...overrides,
});

async function setup(config: Partial<Config> = {}, db?: Db) {
	const t = await testPorts({ config, ...(db ? { db } : {}) });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const store = async (raw: Record<string, unknown>) =>
		storeEvent(t.ports, state, project.id, await prepareEvent(bytes(raw), t.clock.now()), {
			sleep: noSleep,
		});
	const one = <T extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
		t.ports.db.first<T & Record<string, never>>(query) as Promise<T>;
	return { ...t, project, state, store, one };
}

describe("storeEvent", () => {
	it("creates an issue and stores the event (normalized data + compressed raw payload)", async () => {
		const { store, one, ports } = await setup();
		const raw = errorEvent({ extra: { password: "hunter2", note: "kept" } });
		expect(await store(raw)).toMatchObject({ outcome: "stored" });

		const issue = await one<Record<string, unknown>>(sql`SELECT * FROM issues`);
		expect(issue).toMatchObject({
			fingerprint_version: FINGERPRINT_VERSION,
			title: "TypeError: x is undefined",
			culprit: "total (cart)",
			type: "TypeError",
			level: "error",
			status: "unresolved",
			times_seen: 1,
			stored_events: 1,
			first_seen: "2026-10-10T12:00:00.000Z",
			first_release: "app@1.0.0",
		});
		const event = await one<{ data: string; raw: Uint8Array; raw_size: number; event_id: string }>(
			sql`SELECT * FROM events`,
		);
		expect(event.event_id).toBe(raw.event_id);
		expect(JSON.parse(event.data).extra).toEqual({ password: "[Filtered]", note: "kept" });
		const original = JSON.parse(gunzipSync(event.raw).toString("utf8"));
		expect(original.extra).toEqual({ password: "[Filtered]", note: "kept" });
		expect(original.exception).toEqual(raw.exception);
		expect(event.raw_size).toBeGreaterThan(0);
		expect(
			await ports.db.first(sql`SELECT events_received, events_stored FROM daily_usage`),
		).toEqual({
			events_received: 1,
			events_stored: 1,
		});
	});

	it("counts a second event of the same issue and updates last_seen and the release", async () => {
		const { store, one, clock } = await setup();
		await store(errorEvent());
		clock.advance(60_000);
		await store(errorEvent({ release: "app@1.0.1" }));
		expect(
			await one(
				sql`SELECT times_seen, stored_events, last_seen, first_release, last_release FROM issues`,
			),
		).toEqual({
			times_seen: 2,
			stored_events: 2,
			last_seen: "2026-10-10T12:01:00.000Z",
			first_release: "app@1.0.0",
			last_release: "app@1.0.1",
		});
	});

	it("is idempotent for the same event_id (SDK resends)", async () => {
		const { store, one } = await setup();
		const raw = errorEvent();
		await store(raw);
		await store(raw);
		expect(await one(sql`SELECT times_seen, stored_events FROM issues`)).toEqual({
			times_seen: 1,
			stored_events: 1,
		});
	});

	it("stores at most eventsPerIssue events and keeps counting", async () => {
		const { store, one } = await setup({ eventsPerIssue: 3 });
		for (let i = 0; i < 5; i++) await store(errorEvent());
		expect(await one(sql`SELECT times_seen, stored_events FROM issues`)).toEqual({
			times_seen: 5,
			stored_events: 3,
		});
		expect(await one(sql`SELECT COUNT(*) AS n FROM events`)).toEqual({ n: 3 });
	});

	it("drops a raw payload that is too large after compression, and keeps the event", async () => {
		const { store, one } = await setup();
		const noise = Array.from({ length: 16000 }, () => Math.random().toString(36).slice(2)).join("");
		await store(errorEvent({ extra: { noise } }));
		const event = await one<{ raw: unknown; raw_size: number }>(
			sql`SELECT raw, raw_size FROM events`,
		);
		expect(event.raw).toBeNull();
		expect(event.raw_size).toBeGreaterThan(64 * 1024);
	});

	it("stores counters only in budget mode (near the D1 daily write limit)", async () => {
		const { store, one, ports } = await setup({ dailyRowLimit: 100 });
		await ports.db.run(
			sql`INSERT INTO daily_usage (day, rows_written) VALUES (${"2026-10-10"}, ${85})`,
		);
		expect(await store(errorEvent())).toMatchObject({ outcome: "counted" });
		expect(await one(sql`SELECT times_seen, stored_events FROM issues`)).toEqual({
			times_seen: 1,
			stored_events: 0,
		});
		expect(await one(sql`SELECT COUNT(*) AS n FROM events`)).toEqual({ n: 0 });
	});

	it("puts new issues above the hourly cap into one flood issue", async () => {
		const { store, ports, clock } = await setup({ newIssuesPerHour: 2 });
		const typed = (type: string) =>
			errorEvent({
				exception: {
					values: [{ type, value: "v", stacktrace: { frames: [{ module: "m", function: "f" }] } }],
				},
			});
		await store(typed("A"));
		await store(typed("B"));
		await store(typed("C"));
		await store(typed("D"));
		await store(typed("A")); // an existing issue still counts normally
		const issues = await ports.db.all(sql`SELECT title, times_seen FROM issues ORDER BY id`);
		expect(issues).toEqual([
			{ title: "A: v", times_seen: 2 },
			{ title: "B: v", times_seen: 1 },
			{
				title: "Too many new issues: new errors above the hourly limit are grouped here",
				times_seen: 2,
			},
		]);
		clock.advance(3601_000);
		await store(typed("E"));
		expect(await ports.db.first(sql`SELECT title FROM issues ORDER BY id DESC`)).toEqual({
			title: "E: v",
		});
	});

	it("keeps at most tagKeysPerProject tag keys per project", async () => {
		const { store, ports } = await setup({ tagKeysPerProject: 2 });
		await store(errorEvent({ tags: { a: "1", b: "2", c: "3" } }));
		await store(errorEvent({ tags: { a: "4", d: "5" } }));
		const keys = await ports.db.all(sql`SELECT key FROM tag_keys ORDER BY key`);
		expect(keys).toEqual([{ key: "a" }, { key: "b" }]);
		const tags = (
			await ports.db.all<{ data: string }>(sql`SELECT data FROM events ORDER BY id`)
		).map((row) => JSON.parse(row.data).tags);
		expect(tags).toEqual([
			[
				["a", "1"],
				["b", "2"],
			],
			[["a", "4"]],
		]);
	});

	it("retries a failed write and succeeds", async () => {
		const t = await testPorts();
		let failures = 0;
		const flaky: Db = {
			...t.ports.db,
			batch: (statements) =>
				failures-- > 0
					? Promise.reject(new Error("D1_ERROR: network"))
					: t.ports.db.batch(statements),
		};
		const { store, one, state } = await setup({}, flaky);
		failures = 2;
		expect(await store(errorEvent())).toMatchObject({ outcome: "stored", attempts: 3 });
		expect(await one(sql`SELECT times_seen FROM issues`)).toEqual({ times_seen: 1 });
		expect(state.health.snapshot(new Date()).failures).toBe(0);
	});

	it("records a failure after the last attempt, and reports overload after 3 failures", async () => {
		const t = await testPorts();
		let fail = false;
		const failing: Db = {
			...t.ports.db,
			batch: (statements) =>
				fail ? Promise.reject(new Error("D1_ERROR: overloaded")) : t.ports.db.batch(statements),
		};
		const { store, state, ports, clock } = await setup({}, failing);
		fail = true;
		for (let i = 0; i < 3; i++)
			expect(await store(errorEvent())).toMatchObject({ outcome: "failed", attempts: 3 });
		const health = state.health.snapshot(clock.now());
		expect(health.failures).toBe(3);
		expect(health.retryAfterSeconds).toBeGreaterThan(0);
		expect(await ports.db.first(sql`SELECT write_failures FROM daily_usage`)).toEqual({
			write_failures: 3,
		});
		clock.advance(31_000);
		expect(state.health.snapshot(clock.now()).retryAfterSeconds).toBe(0);
	});

	it("does not retry an error that will fail again (constraint)", async () => {
		const t = await testPorts();
		let calls = 0;
		let fail = false;
		const broken: Db = {
			...t.ports.db,
			batch: (statements) => {
				if (!fail) return t.ports.db.batch(statements);
				calls++;
				return Promise.reject(new Error("FOREIGN KEY constraint failed"));
			},
		};
		const { store } = await setup({}, broken);
		fail = true;
		expect(await store(errorEvent())).toMatchObject({ outcome: "failed", attempts: 1 });
		expect(calls).toBe(1);
	});
});

describe("storeEvent: raw payload size", () => {
	it("does not keep the raw payload of an event above 256 KB", async () => {
		const { store, one } = await setup();
		await store(errorEvent({ extra: { pad: "p".repeat(300 * 1024) } }));
		const event = await one<{ raw: unknown; raw_size: number }>(
			sql`SELECT raw, raw_size FROM events`,
		);
		expect(event.raw).toBeNull();
		expect(event.raw_size).toBeGreaterThan(300 * 1024);
	});
});
