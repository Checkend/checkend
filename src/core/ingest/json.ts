import { IngestError } from "./errors.ts";
import { INGEST_LIMITS } from "./limits.ts";

export type JsonObject = { [key: string]: unknown };

const decoder = new TextDecoder("utf-8"); // not fatal: invalid bytes become U+FFFD

/**
 * Parses untrusted JSON bytes into an object. Invalid UTF-8 becomes U+FFFD. A linear scan
 * checks the nesting depth first, so that no later recursive walk can overflow the stack.
 */
export function parseJson(
	bytes: Uint8Array,
	maxDepth: number = INGEST_LIMITS.jsonDepth,
): JsonObject {
	const text = decoder.decode(bytes);
	if (jsonDepth(text) > maxDepth) {
		throw new IngestError(400, "json_too_deep", "The JSON payload is nested too deeply.");
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new IngestError(400, "invalid_json", "The payload is not valid JSON.");
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new IngestError(400, "invalid_json", "The payload must be a JSON object.");
	}
	return value as JsonObject;
}

/**
 * The maximum nesting depth of brackets outside strings. Inside a string it jumps to the
 * next quote with indexOf (native and fast); an odd number of backslashes escapes a quote.
 */
function jsonDepth(text: string): number {
	let depth = 0;
	let max = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 34 /* " */) {
			let end = i + 1;
			for (;;) {
				end = text.indexOf('"', end);
				if (end === -1) return max; // unterminated string: JSON.parse rejects it
				let backslashes = 0;
				while (text.charCodeAt(end - 1 - backslashes) === 92 /* \ */) backslashes++;
				if (backslashes % 2 === 0) break;
				end++;
			}
			i = end;
		} else if (c === 123 /* { */ || c === 91 /* [ */) {
			if (++depth > max) max = depth;
		} else if (c === 125 /* } */ || c === 93 /* ] */) {
			depth--;
		}
	}
	return max;
}
