import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseEnvelope } from "../../../src/core/ingest/envelope.ts";
import { IngestError } from "../../../src/core/ingest/errors.ts";
import { parseJson } from "../../../src/core/ingest/json.ts";
import { loadSentryFixtures } from "../../fixtures/sentry/load.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

function status(run: () => unknown): number {
	try {
		run();
	} catch (error) {
		if (error instanceof IngestError) return error.status;
		throw error;
	}
	return 200;
}

describe("parseJson", () => {
	it("parses an object", () => {
		expect(parseJson(bytes('{"a":[1,{"b":"c"}]}'))).toEqual({ a: [1, { b: "c" }] });
	});

	it("rejects JSON nested deeper than the limit, without recursion", () => {
		const deep = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
		expect(status(() => parseJson(bytes(deep)))).toBe(400);
	});

	it("does not count brackets inside strings as depth", () => {
		const value = { s: "[".repeat(1000) };
		expect(parseJson(bytes(JSON.stringify(value)))).toEqual(value);
	});

	it("handles escaped quotes and backslashes before a quote", () => {
		const value = { a: 'x\\"[[[', b: ["\\\\", { c: ']]]\\\\\\"' }] };
		expect(parseJson(bytes(JSON.stringify(value)))).toEqual(value);
		const tooDeep = `{"s":"\\\\","d":${"[".repeat(70)}${"]".repeat(70)}}`;
		expect(status(() => parseJson(bytes(tooDeep)))).toBe(400);
	});

	it("replaces invalid UTF-8 with U+FFFD instead of failing", () => {
		const invalid = new Uint8Array([...bytes('{"s":"a'), 0xff, 0xfe, ...bytes('b"}')]);
		expect(parseJson(invalid)).toEqual({ s: "a��b" });
	});

	it("rejects invalid JSON and non-object values with 400", () => {
		expect(status(() => parseJson(bytes("{nope")))).toBe(400);
		expect(status(() => parseJson(bytes("[1,2]")))).toBe(400);
		expect(status(() => parseJson(bytes('"text"')))).toBe(400);
	});
});

describe("parseEnvelope", () => {
	it("finds the event item in every golden fixture", () => {
		for (const fixture of loadSentryFixtures()) {
			const body =
				fixture.headers["content-encoding"] === "gzip"
					? new Uint8Array(gunzipSync(fixture.body))
					: fixture.body;
			const envelope = parseEnvelope(body);
			expect(envelope.header.event_id, fixture.name).toMatch(/^[0-9a-f]{32}$/);
			const event = envelope.event ? parseJson(envelope.event) : null;
			expect(event, fixture.name).not.toBeNull();
			// Some SDKs (PHP) put the event_id only in the envelope header.
			if (event?.event_id !== undefined) {
				expect(event.event_id, fixture.name).toBe(envelope.header.event_id);
			}
		}
	});

	it("uses the item length when it is given (payload can contain newlines)", () => {
		const payload = '{"event_id":"a","message":"x"}\n';
		const body = `{"event_id":"a"}\n{"type":"event","length":${bytes(payload).length}}\n${payload}`;
		const envelope = parseEnvelope(bytes(body));
		expect(new TextDecoder().decode(envelope.event ?? new Uint8Array())).toBe(payload);
	});

	it("counts the length in bytes, not characters", () => {
		const payload = '{"m":"日本"}';
		const body = `{}\n{"type":"event","length":${bytes(payload).length}}\n${payload}\n`;
		expect(parseJson(parseEnvelope(bytes(body)).event ?? new Uint8Array())).toEqual({ m: "日本" });
	});

	it("drops items that are not error events", () => {
		const body = [
			"{}",
			'{"type":"session"}',
			'{"sid":"x"}',
			'{"type":"client_report"}',
			'{"discarded_events":[]}',
			'{"type":"attachment","length":3}',
			"abc",
		].join("\n");
		const envelope = parseEnvelope(bytes(body));
		expect(envelope.event).toBeNull();
		expect(envelope.dropped).toEqual(["session", "client_report", "attachment"]);
	});

	it("rejects a length that runs past the end of the body", () => {
		expect(status(() => parseEnvelope(bytes('{}\n{"type":"event","length":999}\n{}')))).toBe(400);
	});

	it("rejects a broken header and too many items", () => {
		expect(status(() => parseEnvelope(bytes("not json\n")))).toBe(400);
		const many = ["{}", ...Array.from({ length: 101 }, () => '{"type":"session"}\n{}')].join("\n");
		expect(status(() => parseEnvelope(bytes(many)))).toBe(400);
	});

	it("rejects a second event item", () => {
		const body = '{}\n{"type":"event"}\n{"a":1}\n{"type":"event"}\n{"b":2}';
		expect(status(() => parseEnvelope(bytes(body)))).toBe(400);
	});
});
