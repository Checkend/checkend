import { gunzipSync } from "node:zlib";
import { parseEnvelope } from "../../../src/core/ingest/envelope.ts";
import { type JsonObject, parseJson } from "../../../src/core/ingest/json.ts";
import { loadSentryFixture } from "../../fixtures/sentry/load.ts";

/** The raw event object inside a golden fixture. */
export function rawEventFromFixture(name: string): JsonObject {
	const fixture = loadSentryFixture(name);
	const body =
		fixture.headers["content-encoding"] === "gzip"
			? new Uint8Array(gunzipSync(fixture.body))
			: fixture.body;
	const event = parseEnvelope(body).event;
	if (!event) throw new Error(`fixture ${name} has no event`);
	return parseJson(event);
}
