import { describe, expect, it } from "vitest";
import { EVENT_LIMITS, normalizeEvent } from "../../../src/core/ingest/normalize.ts";
import { rawEventFromFixture } from "./event-from-fixture.ts";

const received = new Date("2026-10-10T12:00:00Z");
const receivedSeconds = received.getTime() / 1000;
const normalize = (raw: Record<string, unknown>) => normalizeEvent(raw, received);

describe("normalizeEvent: golden fixtures", () => {
	it("keeps the fields of a Node SDK error", () => {
		const raw = rawEventFromFixture("node-type-error");
		const event = normalizeEvent(raw, new Date((raw.timestamp as number) * 1000 + 500));
		expect(event).toMatchObject({
			event_id: raw.event_id,
			level: "error",
			platform: "node",
			release: "fixture-app@1.2.3",
			environment: "production",
			server_name: "fixture-host",
			message: null,
			tags: [["route", "/users/:id"]],
			user: { id: "user-42", email: "ada@example.com" },
			sdk: { name: "sentry.javascript.node", version: "11.6.0" },
		});
		const [exception] = event.exceptions;
		expect(exception?.type).toBe("TypeError");
		expect(exception?.value).toBe("Cannot read properties of undefined (reading 'name')");
		const inApp = exception?.frames.find((f) => f.in_app);
		expect(inApp).toMatchObject({
			filename: "/app/test/fixtures/sentry/capture-node.ts",
			in_app: true,
		});
		expect(inApp?.context_line).toContain("Sentry.withScope");
		expect(event.breadcrumbs[0]).toMatchObject({ category: "db" });
		expect(event.timestamp).toBe(new Date((raw.timestamp as number) * 1000).toISOString());
	});

	it("keeps both exceptions of a chained error", () => {
		const event = normalize(rawEventFromFixture("node-error-with-cause"));
		expect(event.exceptions.map((e) => e.type)).toEqual(["RangeError", "Error"]);
	});

	it("reads the message of a captured message", () => {
		const event = normalize(rawEventFromFixture("node-message"));
		expect(event.message).toBe("Cache miss rate above 90% for key user:1234");
		expect(event.level).toBe("warning");
		// SDK 11 adds a synthetic exception with the stack of the call. It has no type.
		expect(event.exceptions[0]).toMatchObject({
			type: null,
			value: "Cache miss rate above 90% for key user:1234",
			mechanism: { synthetic: true },
		});
	});

	it("keeps the request of a browser event", () => {
		const event = normalize(rawEventFromFixture("browser-unhandled-error"));
		expect(event.request?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/checkout\?scenario=/);
		expect(event.exceptions[0]?.mechanism).toEqual({
			type: "auto.browser.browserapierrors.setTimeout",
			handled: false,
			synthetic: false,
		});
	});
});

describe("normalizeEvent: schema", () => {
	it("drops fields with the wrong type instead of rejecting the event", () => {
		const event = normalize({
			event_id: 42,
			level: ["error"],
			release: { v: 1 },
			exception: "boom",
			tags: 7,
			breadcrumbs: "x",
			user: "ada",
			message: "kept",
		});
		expect(event.event_id).toMatch(/^[0-9a-f]{32}$/);
		expect(event.level).toBe("error");
		expect(event.release).toBeNull();
		expect(event.exceptions).toEqual([]);
		expect(event.tags).toEqual([]);
		expect(event.breadcrumbs).toEqual([]);
		expect(event.user).toBeNull();
		expect(event.message).toBe("kept");
	});

	it("drops one invalid frame and keeps the others", () => {
		const event = normalize({
			exception: {
				values: [{ type: "E", stacktrace: { frames: [{ function: "a" }, 5, { function: "b" }] } }],
			},
		});
		expect(event.exceptions[0]?.frames.map((f) => f.function)).toEqual(["a", "b"]);
	});

	it("accepts the older shapes: exception array, tags object, message object", () => {
		const event = normalize({
			exception: [{ type: "E", value: "v" }],
			tags: { a: "1", b: 2 },
			logentry: { message: "Hello %s", params: ["x"], formatted: "Hello x" },
		});
		expect(event.exceptions[0]?.type).toBe("E");
		expect(event.tags).toEqual([
			["a", "1"],
			["b", "2"],
		]);
		expect(event.message).toBe("Hello x");
		expect(event.message_template).toBe("Hello %s");
	});

	it("uses a valid event_id and removes the dashes of a UUID", () => {
		expect(normalize({ event_id: "0D015BD5-B37B-47A5-B4D1-295B481E68DB" }).event_id).toBe(
			"0d015bd5b37b47a5b4d1295b481e68db",
		);
		expect(normalize({ event_id: "not-an-id" }).event_id).toMatch(/^[0-9a-f]{32}$/);
	});

	it("replaces an unknown level with error", () => {
		expect(normalize({ level: "catastrophic" }).level).toBe("error");
		expect(normalize({ level: "fatal" }).level).toBe("fatal");
	});
});

describe("normalizeEvent: limits", () => {
	it("truncates long strings", () => {
		const event = normalize({
			message: "m".repeat(100_000),
			exception: { values: [{ type: "T".repeat(10_000), value: "v".repeat(100_000) }] },
		});
		expect(event.message?.length).toBe(EVENT_LIMITS.message);
		expect(event.message?.endsWith("…")).toBe(true);
		expect(event.exceptions[0]?.type?.length).toBeLessThanOrEqual(EVENT_LIMITS.shortString);
		expect(event.exceptions[0]?.value.length).toBeLessThanOrEqual(EVENT_LIMITS.message);
	});

	it("keeps the last frames, exceptions and breadcrumbs (nearest to the crash)", () => {
		const frames = Array.from({ length: 1000 }, (_, i) => ({ function: `f${i}` }));
		const exceptions = Array.from({ length: 30 }, (_, i) => ({ type: `E${i}` }));
		exceptions[29] = { type: "E29", stacktrace: { frames } } as never;
		const breadcrumbs = Array.from({ length: 500 }, (_, i) => ({ message: `b${i}` }));
		const event = normalize({
			exception: { values: exceptions },
			breadcrumbs: { values: breadcrumbs },
		});
		expect(event.exceptions).toHaveLength(EVENT_LIMITS.exceptions);
		expect(event.exceptions.at(-1)?.type).toBe("E29");
		const kept = event.exceptions.at(-1)?.frames ?? [];
		expect(kept).toHaveLength(EVENT_LIMITS.frames);
		expect(kept.at(-1)?.function).toBe("f999");
		expect(event.breadcrumbs).toHaveLength(EVENT_LIMITS.breadcrumbs);
		expect(event.breadcrumbs.at(-1)?.message).toBe("b499");
	});

	it("keeps at most 50 tags with valid keys and short values", () => {
		const tags: Record<string, string> = { "bad key!": "x", ok: "v".repeat(1000) };
		for (let i = 0; i < 200; i++) tags[`k${i}`] = "v";
		const event = normalize({ tags });
		expect(event.tags).toHaveLength(EVENT_LIMITS.tags);
		expect(event.tags.some(([k]) => k === "bad key!")).toBe(false);
		expect(event.tags.find(([k]) => k === "ok")?.[1].length).toBeLessThanOrEqual(
			EVENT_LIMITS.tagValue,
		);
	});

	it("limits the depth, keys and array length of free-form data", () => {
		let deep: Record<string, unknown> = { leaf: true };
		for (let i = 0; i < 20; i++) deep = { d: deep };
		const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, i]));
		const event = normalize({
			extra: { deep, wide, list: Array.from({ length: 500 }, (_, i) => i) },
		});
		const json = JSON.stringify(event.extra);
		expect(json).not.toContain("leaf");
		expect(Object.keys((event.extra?.wide ?? {}) as object)).toHaveLength(EVENT_LIMITS.objectKeys);
		expect(event.extra?.list as unknown[]).toHaveLength(EVENT_LIMITS.arrayItems);
	});

	it("keeps the stored JSON under the size limit", () => {
		const big = "x".repeat(1000);
		const breadcrumbs = Array.from({ length: 50 }, () => ({ message: big, data: { big } }));
		const contexts = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`c${i}`, { big }]));
		const event = normalize({ breadcrumbs, contexts, extra: contexts });
		expect(JSON.stringify(event).length).toBeLessThanOrEqual(EVENT_LIMITS.jsonBytes);
		expect(event.truncated).toBe(true);
	});
});

describe("normalizeEvent: timestamps", () => {
	it("accepts seconds and ISO strings", () => {
		expect(normalize({ timestamp: receivedSeconds - 10 }).timestamp).toBe(
			"2026-10-10T11:59:50.000Z",
		);
		expect(normalize({ timestamp: "2026-10-10T11:00:00Z" }).timestamp).toBe(
			"2026-10-10T11:00:00.000Z",
		);
	});

	it("uses the received time when the timestamp is in the future, too old, or invalid", () => {
		for (const timestamp of [receivedSeconds + 3600, receivedSeconds - 40 * 86400, "nope", -1]) {
			expect(normalize({ timestamp }).timestamp).toBe(received.toISOString());
		}
	});

	it("drops breadcrumb timestamps that are not valid", () => {
		const event = normalize({ breadcrumbs: [{ message: "a", timestamp: "nope" }] });
		expect(event.breadcrumbs[0]?.timestamp).toBeNull();
	});

	it("drops breadcrumb timestamps outside the Date range instead of throwing", () => {
		const event = normalize({
			breadcrumbs: [
				{ message: "a", timestamp: 1e20 },
				{ message: "b", timestamp: "99999999999999999999" },
			],
		});
		expect(event.breadcrumbs.map((b) => b.timestamp)).toEqual([null, null]);
	});
});

describe("normalizeEvent: text", () => {
	it("removes control and invisible characters, and repairs lone surrogates", () => {
		const event = normalize({
			message: "a\u0000b\u0007c‮d​e﻿f\uD800g\nh\ti",
		});
		expect(event.message).toBe("abcdef�g\nh\ti");
	});
});
