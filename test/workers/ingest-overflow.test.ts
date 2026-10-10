import {
	applyD1Migrations,
	createExecutionContext,
	createMessageBatch,
	env,
	getQueueResult,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { enqueueEvent } from "../../src/core/ingest/overflow.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { createProject } from "../../src/core/projects.ts";
import worker from "../../src/entry/worker.ts";
import { sql } from "../../src/ports/db.ts";
import { memoryIngestQueue } from "../../src/ports/ingest-queue.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("ingest overflow queue on workerd and D1", () => {
	it("the Worker queue handler writes queued events, one batch per fingerprint", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		const project = await createProject(ports, { name: "Queue D1" });
		const queue = memoryIngestQueue();
		for (const message of ["queued a", "queued a", "queued b"]) {
			const prepared = await prepareEvent(
				new TextEncoder().encode(JSON.stringify({ message })),
				new Date(),
			);
			expect(
				await enqueueEvent(
					{ ingestQueue: queue, blobs: null },
					project.internalId,
					prepared,
					false,
				),
			).toBe(true);
		}
		const batch = createMessageBatch(
			"checkend-ingest-test",
			queue.messages.map((body, i) => ({ id: `m${i}`, timestamp: new Date(), attempts: 1, body })),
		);
		const ctx = createExecutionContext();
		await worker.queue(batch, env, ctx);
		const result = await getQueueResult(batch, ctx);
		expect(result.explicitAcks.sort()).toEqual(["m0", "m1", "m2"]);
		expect(
			await ports.db.all(
				sql`SELECT title, times_seen FROM issues WHERE project_id = ${project.internalId} ORDER BY title`,
			),
		).toEqual([
			{ title: "queued a", times_seen: 2 },
			{ title: "queued b", times_seen: 1 },
		]);
	});
});
