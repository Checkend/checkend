import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, MAX_RAW_BYTES, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { runRetention } from "../../src/core/retention.ts";
import { memoryBlobStore } from "../../src/ports/blob-store.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

/** Text that gzip cannot make much smaller. */
const noise = (bytes: number) =>
	Array.from({ length: bytes / 8 }, () => Math.random().toString(36).slice(2, 10)).join("");

async function setup(withBlobs: boolean) {
	const blobs = memoryBlobStore();
	const t = await testPorts({ blobs: withBlobs ? blobs : null, config: { retentionDays: 1 } });
	const project = await createProject(t.ports, { name: "Shop" });
	const store = async (payload: Record<string, unknown>) => {
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(payload)),
			t.clock.now(),
		);
		await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
		return prepared;
	};
	const row = () =>
		t.ports.db.first<{ raw: Uint8Array | null; raw_key: string | null; raw_size: number }>(
			sql`SELECT raw, raw_key, raw_size FROM events ORDER BY id DESC LIMIT 1`,
		);
	return { ...t, blobs, project, store, row };
}

describe("large raw payloads go to blob storage", () => {
	it("keeps a small payload in D1, as before", async () => {
		const { store, row } = await setup(true);
		await store({ message: "small" });
		expect(await row()).toMatchObject({ raw_key: null, raw: expect.any(Uint8Array) });
	});

	it("puts a payload above the D1 limit into blob storage, and the event row keeps its key", async () => {
		const { store, row, blobs, project } = await setup(true);
		const prepared = await store({ message: "large", extra: { dump: noise(MAX_RAW_BYTES * 2) } });
		const event = await row();
		expect(event?.raw).toBeNull();
		expect(event?.raw_key).toBe(`raw/${project.internalId}/${prepared.event.event_id}.json.gz`);
		const blob = await blobs.get(event?.raw_key as string);
		expect(JSON.parse(gunzipSync(blob as Uint8Array).toString("utf8"))).toEqual(
			JSON.parse(prepared.rawJson as string),
		);
	});

	it("drops a large payload without blob storage, as before", async () => {
		const { store, row } = await setup(false);
		await store({ message: "large", extra: { dump: noise(MAX_RAW_BYTES * 2) } });
		expect(await row()).toMatchObject({ raw: null, raw_key: null });
	});

	it("retention deletes the blobs of the events it deletes", async () => {
		const { store, row, blobs, ports, clock } = await setup(true);
		await store({ message: "large", extra: { dump: noise(MAX_RAW_BYTES * 2) } });
		const key = (await row())?.raw_key as string;
		clock.advance(2 * 86_400_000);
		await runRetention(ports, clock.now());
		expect(await blobs.get(key)).toBeNull();
	});
});
