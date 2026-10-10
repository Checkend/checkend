import { checkQueueMessage, type IngestQueue } from "../../ports/ingest-queue.ts";

/** IngestQueue on a Cloudflare Queue producer binding. */
export function cloudflareIngestQueue(queue: Pick<Queue<object>, "send">): IngestQueue {
	return {
		async send(message) {
			checkQueueMessage(message);
			await queue.send(message, { contentType: "json" });
		},
	};
}
