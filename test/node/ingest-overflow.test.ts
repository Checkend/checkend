import { describe, expect, it } from "vitest";
import { consumeIngest, type IngestMessage } from "../../src/core/ingest/overflow.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { memoryBlobStore } from "../../src/ports/blob-store.ts";
import { type Db, sql } from "../../src/ports/db.ts";
import { memoryIngestQueue } from "../../src/ports/ingest-queue.ts";
import { testPorts } from "../support/node-ports.ts";

async function setup(overrides: Parameters<typeof testPorts>[0] = {}) {
	const queue = memoryIngestQueue();
	const t = await testPorts({ ingestQueue: queue, ...overrides });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const send = async (message: string, extra: Record<string, unknown> = {}) => {
		const response = await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message, ...extra }),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return response.status;
	};
	/** The queued messages as the consumer gets them. */
	const deliver = async (messages = queue.messages.splice(0)) => {
		const acked: number[] = [];
		const retried: number[] = [];
		await consumeIngest(
			t.ports,
			state,
			messages.map((body, i) => ({
				body,
				ack: () => acked.push(i),
				retry: () => retried.push(i),
			})),
		);
		await t.settle();
		return { acked, retried };
	};
	const overload = () => {
		for (let i = 0; i < 3; i++) state.health.recordFailure(t.clock.now());
	};
	return { ...t, queue, project, state, send, deliver, overload };
}

/** A Db that counts batch() calls and can fail them. */
function countingDb(db: Db, failing: { on: boolean }) {
	const calls = { batches: 0 };
	const wrapped: Db = {
		...db,
		all: (s) => db.all(s),
		first: (s) => db.first(s),
		run: (s) => db.run(s),
		batch: async (statements) => {
			calls.batches++;
			if (failing.on) throw new Error("D1_ERROR: Network connection lost.");
			return db.batch(statements);
		},
	};
	return { db: wrapped, calls };
}

describe("ingest overflow queue (direct mode stays the default)", () => {
	it("writes directly when D1 is healthy, and sends nothing to the queue", async () => {
		const { send, queue, ports } = await setup();
		expect(await send("cart total failed")).toBe(200);
		expect(queue.messages).toEqual([]);
		expect(await ports.db.first(sql`SELECT times_seen FROM issues`)).toEqual({ times_seen: 1 });
	});

	it("queues events while D1 is overloaded, instead of 429", async () => {
		const { send, queue, overload, ports } = await setup();
		overload();
		expect(await send("cart total failed")).toBe(200);
		expect(queue.messages).toHaveLength(1);
		expect(queue.messages[0]).toMatchObject({ kind: "ingest", v: 1, browser: false });
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM issues`)).toEqual({ n: 0 });
	});

	it("still answers 429 when D1 is overloaded and there is no queue", async () => {
		const { send, overload } = await setup({ ingestQueue: null });
		overload();
		expect(await send("cart total failed")).toBe(429);
	});

	it("queues an event whose direct write failed after all retries", async () => {
		const failing = { on: false };
		const base = await testPorts();
		const { db } = countingDb(base.ports.db, failing);
		const { send, queue } = await setup({ db });
		failing.on = true;
		expect(await send("cart total failed")).toBe(200);
		expect(queue.messages).toHaveLength(1);
	});

	it("the consumer writes one batch per fingerprint, counts each event once, and keeps sampling", async () => {
		const failing = { on: false };
		const base = await testPorts();
		const { db, calls } = countingDb(base.ports.db, failing);
		const { send, queue, overload, deliver, ports } = await setup({
			db,
			config: { eventsPerIssue: 2 },
		});
		overload();
		for (const message of ["a", "a", "a", "b", "b"]) await send(message);
		const duplicate = queue.messages[0] as IngestMessage;
		queue.messages.push(duplicate); // at-least-once: the same message again
		calls.batches = 0;
		const { acked, retried } = await deliver();
		expect(calls.batches).toBe(2);
		expect(acked).toHaveLength(6);
		expect(retried).toEqual([]);
		expect(
			await ports.db.all(sql`SELECT title, times_seen, stored_events FROM issues ORDER BY title`),
		).toEqual([
			{ title: "a", times_seen: 3, stored_events: 2 },
			{ title: "b", times_seen: 2, stored_events: 2 },
		]);
	});

	it("retries the messages of a group whose write fails", async () => {
		const failing = { on: false };
		const base = await testPorts();
		const { db } = countingDb(base.ports.db, failing);
		const { send, overload, deliver } = await setup({ db });
		overload();
		await send("a");
		failing.on = true;
		const { acked, retried } = await deliver();
		expect(acked).toEqual([]);
		expect(retried).toEqual([0]);
	});

	it("puts a large event into blob storage and sends its key; the consumer deletes the blob", async () => {
		const blobs = memoryBlobStore();
		const { send, queue, overload, deliver, ports } = await setup({ blobs });
		overload();
		await send("big", { extra: { notes: "x".repeat(200_000) } });
		const message = queue.messages[0] as IngestMessage;
		expect(message.blob_key).toMatch(/^ingest\/[0-9a-f-]{36}\.json$/);
		expect(message.prepared).toBeUndefined();
		await deliver();
		expect(await ports.db.first(sql`SELECT times_seen FROM issues`)).toEqual({ times_seen: 1 });
		expect(await blobs.get(message.blob_key as string)).toBeNull();
	});

	it("answers 429 for a large event when it cannot be queued (no blob storage)", async () => {
		const { send, overload } = await setup({ blobs: null });
		overload();
		expect(await send("big", { extra: { notes: "x".repeat(200_000) } })).toBe(429);
	});

	it("drops a message that it cannot read, and acknowledges it (no endless retries)", async () => {
		const { deliver } = await setup();
		const { acked } = await deliver([
			{ kind: "ingest", v: 99 },
			{ kind: "ingest", v: 1, blob_key: "ingest/missing.json", project_id: 1, browser: false },
		]);
		expect(acked).toEqual([0, 1]);
	});
});
