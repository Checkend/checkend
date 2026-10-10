import { type Fingerprint, fingerprintEvent, type IssueTitle, issueTitle } from "./fingerprint.ts";
import { type JsonObject, parseJson } from "./json.ts";
import { type NormalizedEvent, normalizeEvent } from "./normalize.ts";
import { scrub } from "./scrub.ts";

/** An event that passed input layers 1 and 2, ready for the write. */
export interface PreparedEvent {
	event: NormalizedEvent;
	fingerprint: Fingerprint;
	title: IssueTitle;
	/** The original payload as JSON, with secrets scrubbed. For re-processing only. */
	rawJson: string;
	receivedAt: Date;
}

/** Parses, scrubs, normalizes and fingerprints one event payload. CPU work only, no I/O. */
export async function prepareEvent(payload: Uint8Array, receivedAt: Date): Promise<PreparedEvent> {
	const scrubbed = scrub(parseJson(payload)) as JsonObject;
	const event = normalizeEvent(scrubbed, receivedAt);
	return {
		event,
		fingerprint: await fingerprintEvent(event),
		title: issueTitle(event),
		rawJson: JSON.stringify(scrubbed),
		receivedAt,
	};
}
