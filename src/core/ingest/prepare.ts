import { type Fingerprint, fingerprintEvent, type IssueTitle, issueTitle } from "./fingerprint.ts";
import { type JsonObject, parseJson } from "./json.ts";
import { INGEST_LIMITS } from "./limits.ts";
import { type NormalizedEvent, normalizeEvent } from "./normalize.ts";
import { scrub } from "./scrub.ts";

/** An event that passed input layers 1 and 2, ready for the write. */
export interface PreparedEvent {
	event: NormalizedEvent;
	fingerprint: Fingerprint;
	title: IssueTitle;
	/**
	 * The original payload as JSON, with secrets scrubbed. For re-processing only. Null for a
	 * payload above INGEST_LIMITS.rawBytes: scrubbing and compressing it costs too much CPU.
	 */
	rawJson: string | null;
	/** The size of the payload as received (after decompression). */
	payloadBytes: number;
	receivedAt: Date;
}

/**
 * Parses, normalizes, scrubs and fingerprints one event payload. CPU work only, no I/O.
 * Normalization comes first, so that scrubbing works on bounded data. Normalization scrubs
 * each string before it truncates it, so that a cut cannot leave part of a secret.
 */
export async function prepareEvent(payload: Uint8Array, receivedAt: Date): Promise<PreparedEvent> {
	const raw = parseJson(payload);
	const event = scrub(normalizeEvent(raw, receivedAt), { patterns: false }) as NormalizedEvent;
	return {
		event,
		fingerprint: await fingerprintEvent(event),
		title: issueTitle(event),
		rawJson:
			payload.byteLength <= INGEST_LIMITS.rawBytes
				? JSON.stringify(scrub(raw) as JsonObject)
				: null,
		payloadBytes: payload.byteLength,
		receivedAt,
	};
}
