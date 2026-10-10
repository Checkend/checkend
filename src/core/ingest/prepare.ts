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
	/** A hash of the user (ID, email, username or IP address), or null when there is no user. */
	userHash: string | null;
	receivedAt: Date;
}

/** The first 16 bytes of SHA-256 of the user identity, as hex. The identity is not stored. */
async function userHash(user: Record<string, unknown> | null): Promise<string | null> {
	const identity = [user?.id, user?.email, user?.username, user?.ip_address].find(
		(value) => (typeof value === "string" && value.length > 0) || typeof value === "number",
	);
	if (identity === undefined) return null;
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`user:${String(identity)}`),
	);
	return [...new Uint8Array(digest)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
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
		userHash: await userHash(event.user),
		receivedAt,
	};
}
