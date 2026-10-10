import { IngestError } from "./errors.ts";
import { type JsonObject, parseJson } from "./json.ts";
import { INGEST_LIMITS } from "./limits.ts";

export interface Envelope {
	header: JsonObject;
	/** The payload of the error event item, or null when the envelope has none. */
	event: Uint8Array | null;
	/** Types of the items that were dropped (sessions, transactions, attachments, ...). */
	dropped: string[];
}

const NEWLINE = 10;

/**
 * Parses a Sentry envelope: a header line, then items, each a header line and a payload.
 * A payload is `length` bytes when the item header gives a length, otherwise one line.
 * Only `event` items (errors and messages) are kept.
 * https://develop.sentry.dev/sdk/data-model/envelopes/
 */
export function parseEnvelope(body: Uint8Array): Envelope {
	let offset = 0;
	const line = (): Uint8Array => {
		let end = body.indexOf(NEWLINE, offset);
		if (end === -1) end = body.length;
		const slice = body.subarray(offset, end);
		offset = end + 1;
		return slice;
	};

	const header = parseJson(line(), 8);
	let event: Uint8Array | null = null;
	const dropped: string[] = [];
	let items = 0;

	while (offset < body.length) {
		const itemHeaderBytes = line();
		if (itemHeaderBytes.length === 0) continue; // trailing newline
		if (++items > INGEST_LIMITS.envelopeItems) {
			throw new IngestError(400, "too_many_items", "The envelope has too many items.");
		}
		const itemHeader = parseJson(itemHeaderBytes, 8);
		const length = itemHeader.length;

		let payload: Uint8Array;
		if (length === undefined) {
			payload = line();
		} else {
			if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
				throw new IngestError(400, "invalid_envelope", "An item length is invalid.");
			}
			if (offset + length > body.length) {
				throw new IngestError(400, "invalid_envelope", "An item is longer than the envelope.");
			}
			payload = body.subarray(offset, offset + length);
			offset += length;
			if (offset < body.length && body[offset] === NEWLINE) offset++;
		}

		const type = typeof itemHeader.type === "string" ? itemHeader.type : "unknown";
		if (type === "event") {
			if (event)
				throw new IngestError(400, "invalid_envelope", "An envelope has one event at most.");
			event = payload;
		} else {
			dropped.push(type);
		}
	}
	return { header, event, dropped };
}
