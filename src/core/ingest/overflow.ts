import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { MAX_QUEUE_MESSAGE_BYTES } from "../../ports/ingest-queue.ts";
import { startDeliveries } from "../webhooks.ts";
import type { PreparedEvent } from "./prepare.ts";
import type { IngestState } from "./state.ts";
import { storeEvents } from "./store.ts";

/**
 * Queue mode as an overflow buffer (direct mode stays the default). When D1 is overloaded, or a
 * direct write fails after its retries, ingest sends the prepared event to the ingest queue
 * (the optional INGEST_QUEUE binding) instead of answering 429 or dropping it. The consumer
 * groups the events by project and fingerprint and writes each group in one batch. Writes are
 * idempotent per event_id, so a message that comes twice counts once.
 */
export interface IngestMessage {
	kind: "ingest";
	v: 1;
	/** The internal project row ID. */
	project_id: number;
	browser: boolean;
	/** The prepared event; or blob_key, when the message would be too large for the queue. */
	prepared?: PreparedEvent;
	blob_key?: string;
}

export interface QueuedItem {
	body: unknown;
	ack(): void;
	retry(): void;
}

const encoder = new TextEncoder();

/** Sends a prepared event to the overflow queue. False when it cannot (no queue, too large). */
export async function enqueueEvent(
	ports: Pick<Ports, "ingestQueue" | "blobs">,
	projectId: number,
	prepared: PreparedEvent,
	browser: boolean,
): Promise<boolean> {
	if (!ports.ingestQueue) return false;
	const message: IngestMessage = { kind: "ingest", v: 1, project_id: projectId, browser, prepared };
	try {
		const json = JSON.stringify(message);
		if (encoder.encode(json).byteLength <= MAX_QUEUE_MESSAGE_BYTES) {
			await ports.ingestQueue.send(message);
			return true;
		}
		if (!ports.blobs) return false;
		const blobKey = `ingest/${crypto.randomUUID()}.json`;
		await ports.blobs.put(blobKey, JSON.stringify(prepared));
		const { prepared: _large, ...small } = message;
		await ports.ingestQueue.send({ ...small, blob_key: blobKey });
		return true;
	} catch (error) {
		// Workers Logs. Checkend never reports its own errors to itself (AGENTS.md).
		console.error(
			JSON.stringify({
				message: "checkend: ingest queue send failed",
				error: String(error).slice(0, 300),
			}),
		);
		return false;
	}
}

const isMessage = (body: unknown): body is IngestMessage => {
	const m = body as Partial<IngestMessage> | null;
	return (
		typeof m === "object" &&
		m !== null &&
		m.kind === "ingest" &&
		m.v === 1 &&
		Number.isInteger(m.project_id) &&
		typeof m.browser === "boolean" &&
		(typeof m.prepared === "object" || typeof m.blob_key === "string")
	);
};

/**
 * The consumer: one batch per project and fingerprint. A group whose write fails is retried
 * (the queue delivers it again); a message that cannot be read is acknowledged and logged, so
 * that it does not come back for ever.
 */
export async function consumeIngest(
	ports: Ports,
	state: IngestState,
	items: QueuedItem[],
): Promise<void> {
	const groups = new Map<
		string,
		{
			projectId: number;
			entries: { item: QueuedItem; prepared: PreparedEvent; browser: boolean; blobKey?: string }[];
		}
	>();
	for (const item of items) {
		const body = item.body;
		let prepared: PreparedEvent | null = null;
		if (isMessage(body)) {
			if (body.prepared) {
				prepared = body.prepared;
			} else if (body.blob_key && ports.blobs) {
				const bytes = await ports.blobs.get(body.blob_key);
				prepared = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as PreparedEvent) : null;
			}
		}
		if (!isMessage(body) || !prepared?.fingerprint?.hash) {
			console.error(JSON.stringify({ message: "checkend: unreadable ingest message dropped" }));
			item.ack();
			continue;
		}
		const key = `${body.project_id}:${prepared.fingerprint.hash}`;
		const group = groups.get(key) ?? { projectId: body.project_id, entries: [] };
		group.entries.push({
			item,
			prepared,
			browser: body.browser,
			...(body.blob_key ? { blobKey: body.blob_key } : {}),
		});
		groups.set(key, group);
	}
	let deliveries = 0;
	for (const { projectId, entries } of groups.values()) {
		// A project deleted after the event was queued: its events are dropped.
		const live = await ports.db.first(
			sql`SELECT 1 AS live FROM projects WHERE id = ${projectId} AND deleted_at IS NULL`,
		);
		if (!live) {
			for (const entry of entries) {
				if (entry.blobKey) await ports.blobs?.delete(entry.blobKey).catch(() => {});
				entry.item.ack();
			}
			continue;
		}
		const result = await storeEvents(ports, state, projectId, entries);
		if (result.outcome === "failed") {
			for (const entry of entries) entry.item.retry();
			continue;
		}
		deliveries += result.deliveries;
		for (const entry of entries) {
			entry.item.ack();
			if (entry.blobKey) await ports.blobs?.delete(entry.blobKey).catch(() => {});
		}
	}
	if (deliveries > 0) await startDeliveries(ports);
}
