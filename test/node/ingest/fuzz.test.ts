import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseEnvelope } from "../../../src/core/ingest/envelope.ts";
import { IngestError } from "../../../src/core/ingest/errors.ts";
import { fingerprintEvent } from "../../../src/core/ingest/fingerprint.ts";
import { parseJson } from "../../../src/core/ingest/json.ts";
import { EVENT_LIMITS, normalizeEvent } from "../../../src/core/ingest/normalize.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { FILTERED, isSensitiveKey, scrub } from "../../../src/core/ingest/scrub.ts";

/**
 * Property-based fuzzing of the parser, scrubber, normalizer and fingerprint (H2).
 * A failure prints the smallest input that breaks the property.
 */
const received = new Date("2026-10-10T12:00:00Z");
const runs = { numRuns: 300 };

/** Only IngestError may escape: it becomes a 4xx response. Anything else is a bug (500). */
const onlyIngestErrors = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		if (!(error instanceof IngestError)) throw error;
	}
};

// Values that look like Sentry events: known keys with values of any type.
const eventLike = fc.dictionary(
	fc.constantFrom(
		"event_id",
		"timestamp",
		"level",
		"platform",
		"release",
		"message",
		"logentry",
		"exception",
		"tags",
		"user",
		"request",
		"contexts",
		"extra",
		"breadcrumbs",
		"fingerprint",
		"sdk",
	),
	fc.jsonValue({ maxDepth: 6 }),
);

const exceptionEvent = fc.record({
	exception: fc.record({
		values: fc.array(
			fc.record({
				type: fc.string(),
				value: fc.string(),
				stacktrace: fc.record({
					frames: fc.array(
						fc.record({
							filename: fc.string(),
							function: fc.string(),
							module: fc.option(fc.string(), { nil: undefined }),
							lineno: fc.integer(),
							in_app: fc.boolean(),
						}),
						{ maxLength: 80 },
					),
				}),
			}),
			{ maxLength: 12 },
		),
	}),
});

describe("fuzz: parsers", () => {
	it("parseJson only throws IngestError, for any bytes", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) =>
				onlyIngestErrors(() => parseJson(bytes)),
			),
			runs,
		);
	});

	it("parseEnvelope only throws IngestError, for any bytes", () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 2048 }), (bytes) =>
				onlyIngestErrors(() => parseEnvelope(bytes)),
			),
			runs,
		);
	});

	it("parseEnvelope only throws IngestError, for envelope-like text", () => {
		const line = fc.oneof(
			fc.json(),
			fc.constant('{"type":"event"}'),
			fc.integer({ min: -5, max: 500 }).map((n) => `{"type":"event","length":${n}}`),
			fc.string(),
		);
		fc.assert(
			fc.property(fc.array(line, { maxLength: 12 }), (lines) =>
				onlyIngestErrors(() => parseEnvelope(new TextEncoder().encode(lines.join("\n")))),
			),
			runs,
		);
	});
});

describe("fuzz: scrub", () => {
	it("never keeps the value of a sensitive key, at any depth", () => {
		const sensitive = fc.constantFrom(
			"password",
			"api_key",
			"Authorization",
			"session_token",
			"cookie",
		);
		fc.assert(
			fc.property(
				fc.jsonValue({ maxDepth: 4 }),
				sensitive,
				fc.jsonValue({ maxDepth: 2 }),
				(value, key, secret) => {
					const out = scrub({ wrapper: [{ [key]: secret, other: value }] }) as {
						wrapper: [Record<string, unknown>];
					};
					expect(out.wrapper[0][key]).toBe(FILTERED);
				},
			),
			runs,
		);
	});

	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.jsonValue({ maxDepth: 5 }), (value) => {
				const once = scrub(value);
				expect(scrub(once)).toEqual(once);
			}),
			runs,
		);
	});

	it("never throws for any string, and returns a string", () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 300 }), (text) => {
				const out = scrub({ text }) as { text: string };
				expect(typeof out.text).toBe("string");
			}),
			runs,
		);
	});

	it("isSensitiveKey never throws", () => {
		fc.assert(
			fc.property(fc.string(), (key) => typeof isSensitiveKey(key) === "boolean"),
			runs,
		);
	});
});

describe("fuzz: normalizeEvent", () => {
	it("never throws and always respects the limits", () => {
		fc.assert(
			fc.property(fc.oneof(eventLike, exceptionEvent), (raw) => {
				const event = normalizeEvent(raw as Record<string, unknown>, received);
				expect(new TextEncoder().encode(JSON.stringify(event)).byteLength).toBeLessThanOrEqual(
					EVENT_LIMITS.jsonBytes,
				);
				expect(event.exceptions.length).toBeLessThanOrEqual(EVENT_LIMITS.exceptions);
				for (const e of event.exceptions)
					expect(e.frames.length).toBeLessThanOrEqual(EVENT_LIMITS.frames);
				expect(event.tags.length).toBeLessThanOrEqual(EVENT_LIMITS.tags);
				expect(event.breadcrumbs.length).toBeLessThanOrEqual(EVENT_LIMITS.breadcrumbs);
				expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
				expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false);
				expect(event.message === null || event.message.length <= EVENT_LIMITS.message).toBe(true);
			}),
			runs,
		);
	});
});

describe("fuzz: fingerprint", () => {
	it("is deterministic and ignores line numbers", async () => {
		await fc.assert(
			fc.asyncProperty(exceptionEvent, fc.integer(), async (raw, lineno) => {
				const a = await fingerprintEvent(normalizeEvent(raw, received));
				const moved = structuredClone(raw);
				for (const v of moved.exception.values)
					for (const f of v.stacktrace.frames) f.lineno = lineno;
				const b = await fingerprintEvent(normalizeEvent(moved, received));
				expect(b.hash).toBe(a.hash);
				expect(a.hash).toMatch(/^[0-9a-f]{32}$/);
			}),
			{ numRuns: 150 },
		);
	});
});

describe("fuzz: prepareEvent (the whole CPU path)", () => {
	it("only throws IngestError, for any JSON value as the payload", async () => {
		await fc.assert(
			fc.asyncProperty(fc.oneof(fc.jsonValue({ maxDepth: 6 }), eventLike), async (value) => {
				try {
					await prepareEvent(new TextEncoder().encode(JSON.stringify(value)), received);
				} catch (error) {
					if (!(error instanceof IngestError)) throw error;
				}
			}),
			runs,
		);
	});
});
