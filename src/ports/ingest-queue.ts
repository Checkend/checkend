/**
 * A queue for ingest overflow: when D1 is overloaded or a write fails, ingest sends the prepared
 * event here instead of dropping it. Adapters: Cloudflare Queues (the optional INGEST_QUEUE
 * binding) and the memory queue below (tests). Consumers must be idempotent (at-least-once).
 */
export interface IngestQueue {
	/** Sends one JSON message. Rejects a message above MAX_QUEUE_MESSAGE_BYTES. */
	send(message: object): Promise<void>;
}

/**
 * Cloudflare Queues allow 128 KB per message, with some overhead included; 120 KB of JSON leaves
 * room for it.
 */
export const MAX_QUEUE_MESSAGE_BYTES = 120 * 1024;

/** Throws a RangeError when the JSON of the message is above the limit. Every adapter calls it. */
export function checkQueueMessage(message: object): void {
	const bytes = new TextEncoder().encode(JSON.stringify(message)).byteLength;
	if (bytes > MAX_QUEUE_MESSAGE_BYTES) {
		throw new RangeError(`A queue message is ${bytes} bytes; at most ${MAX_QUEUE_MESSAGE_BYTES}.`);
	}
}

/** A queue in memory: the sent messages, in order. For tests. */
export function memoryIngestQueue(): IngestQueue & { messages: object[] } {
	const messages: object[] = [];
	return {
		messages,
		async send(message) {
			checkQueueMessage(message);
			messages.push(JSON.parse(JSON.stringify(message)) as object);
		},
	};
}
