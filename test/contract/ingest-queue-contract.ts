import { describe, expect, it } from "vitest";
import { type IngestQueue, MAX_QUEUE_MESSAGE_BYTES } from "../../src/ports/ingest-queue.ts";

/** The behaviour every IngestQueue adapter must have: workerd runs it on a Cloudflare Queue. */
export function ingestQueueContract(adapterName: string, makeQueue: () => IngestQueue): void {
	describe(`IngestQueue contract: ${adapterName}`, () => {
		it("accepts a JSON message up to the size limit", async () => {
			const queue = makeQueue();
			await queue.send({ kind: "ingest", text: "x".repeat(MAX_QUEUE_MESSAGE_BYTES - 100) });
		});

		it("rejects a message above the size limit with a RangeError", async () => {
			const queue = makeQueue();
			await expect(
				queue.send({ kind: "ingest", text: "x".repeat(MAX_QUEUE_MESSAGE_BYTES) }),
			).rejects.toThrow(RangeError);
		});
	});
}
