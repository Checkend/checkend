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

/** The maximum nesting depth of brackets outside strings. */
function jsonDepth(text: string): number {
	let depth = 0;
	let max = 0;
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (inString) {
			if (c === 92 /* \ */) i++;
			else if (c === 34 /* " */) inString = false;
		} else if (c === 34) inString = true;
		else if (c === 123 /* { */ || c === 91 /* [ */) {
			depth++;
			if (depth > max) max = depth;
		} else if (c === 125 /* } */ || c === 93 /* ] */) depth--;
	}
	return max;
}
