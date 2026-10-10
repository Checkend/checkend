import { describe, expect, it } from "vitest";
import {
	FINGERPRINT_VERSION,
	fingerprintEvent,
	issueTitle,
	normalizeFilename,
	normalizeMessage,
} from "../../../src/core/ingest/fingerprint.ts";
import { type NormalizedEvent, normalizeEvent } from "../../../src/core/ingest/normalize.ts";
import { loadSentryFixtures } from "../../fixtures/sentry/load.ts";
import { rawEventFromFixture } from "./event-from-fixture.ts";

const received = new Date("2026-10-10T12:00:00Z");
const event = (raw: Record<string, unknown>): NormalizedEvent => normalizeEvent(raw, received);
const hash = async (raw: Record<string, unknown>) => (await fingerprintEvent(event(raw))).hash;

const error = (
	type: string,
	value: string,
	frames: Record<string, unknown>[],
	extra: Record<string, unknown> = {},
) => ({ exception: { values: [{ type, value, stacktrace: { frames } }] }, ...extra });

const appFrame = (fn: string, lineno = 10, file = "/srv/app/src/users.ts") => ({
	filename: file,
	module: "users",
	function: fn,
	lineno,
	colno: 5,
	in_app: true,
});

describe("normalizeMessage", () => {
	it.each([
		["Failed for order 5521", "Failed for order <num>"],
		["User 7b2a6c1e-1f3d-4a5b-9c8d-0e1f2a3b4c5d not found", "User <uuid> not found"],
		["Commit deadbeefcafe1234 missing", "Commit <hex> missing"],
		["Mail to ada@example.com bounced", "Mail to <email> bounced"],
		["GET https://api.example.com/v1/users?id=3 failed", "GET <url> failed"],
		["Host 10.0.0.12 is down", "Host <ip> is down"],
		["Key 'user:1234' and \"x\" missing", "Key <str> and <str> missing"],
		["At 2026-10-10T12:00:00Z timeout", "At <date> timeout"],
		["  many   spaces\n", "many spaces"],
	])("normalizes %j", (input, output) => {
		expect(normalizeMessage(input)).toBe(output);
	});
});

describe("normalizeFilename", () => {
	it.each([
		["http://127.0.0.1:60288/assets/app.3f9a2c1b.js", "/assets/app.js"],
		[
			"https://cdn.example.com/static/js/main-4f2a9c8e1b.chunk.js?v=2#x",
			"/static/js/main.chunk.js",
		],
		["/srv/releases/20261010/app/src/users.ts", "app/src/users.ts"],
		["webpack:///./src/cart.ts", "src/cart.ts"],
	])("normalizes %s", (input, output) => {
		expect(normalizeFilename(input)).toBe(output);
	});
});

describe("fingerprintEvent", () => {
	it("returns version 1 and a 32-character hex hash", async () => {
		const result = await fingerprintEvent(event(error("TypeError", "x", [appFrame("load")])));
		expect(result.version).toBe(FINGERPRINT_VERSION);
		expect(FINGERPRINT_VERSION).toBe(1);
		expect(result.hash).toMatch(/^[0-9a-f]{32}$/);
		expect(result.method).toBe("stack");
	});

	it("ignores line numbers, columns and the message when there is a stack", async () => {
		const a = await hash(error("TypeError", "id 1", [appFrame("load", 10)]));
		const b = await hash(error("TypeError", "id 2", [appFrame("load", 99)]));
		expect(a).toBe(b);
	});

	it("separates different error types and different in-app functions", async () => {
		const base = await hash(error("TypeError", "x", [appFrame("load")]));
		expect(await hash(error("RangeError", "x", [appFrame("load")]))).not.toBe(base);
		expect(await hash(error("TypeError", "x", [appFrame("save")]))).not.toBe(base);
	});

	it("ignores frames that are not in-app when in-app frames exist", async () => {
		const lib = { filename: "/srv/node_modules/lib/index.js", function: "inner", in_app: false };
		const a = await hash(error("E", "x", [lib, appFrame("load")]));
		const b = await hash(error("E", "x", [{ ...lib, function: "other" }, appFrame("load")]));
		expect(a).toBe(b);
	});

	it("keeps the same group when a deploy changes the bundle hash in a file name", async () => {
		const frame = (file: string) => ({ filename: file, function: "computeTotal", in_app: true });
		const a = await hash(error("E", "x", [frame("https://shop.example/assets/app.3f9a2c1b.js")]));
		const b = await hash(error("E", "x", [frame("https://shop.example/assets/app.9e8d7c6b.js")]));
		expect(a).toBe(b);
	});

	it("uses type + message when the frames are only minified names", async () => {
		const frames = (names: string[]) =>
			names.map((fn) => ({
				filename: "https://shop.example/assets/app.3f9a2c1b.js",
				function: fn,
				in_app: true,
			}));
		const a = await fingerprintEvent(
			event(error("Error", "Order 5521 failed", frames(["r", "?"]))),
		);
		const b = await fingerprintEvent(event(error("Error", "Order 77 failed", frames(["t", "e"]))));
		expect(a.method).toBe("message");
		expect(a.hash).toBe(b.hash);
	});

	it("groups messages by the normalized message and ignores a synthetic stack", async () => {
		const message = (text: string, fn: string) => ({
			message: text,
			exception: {
				values: [
					{
						value: text,
						mechanism: { type: "generic", synthetic: true },
						stacktrace: { frames: [appFrame(fn)] },
					},
				],
			},
		});
		const a = await fingerprintEvent(event(message("Cache miss for user:1", "a")));
		const b = await fingerprintEvent(event(message("Cache miss for user:2", "b")));
		expect(a.method).toBe("message");
		expect(a.hash).toBe(b.hash);
	});

	it("prefers the message template when the SDK sends one", async () => {
		const a = await hash({ logentry: { message: "Hello %s", formatted: "Hello Ada" } });
		const b = await hash({ logentry: { message: "Hello %s", formatted: "Hello Grace" } });
		expect(a).toBe(b);
	});

	it("gives the SDK fingerprint priority and expands {{ default }}", async () => {
		const base = error("TypeError", "x", [appFrame("load")]);
		const custom = await fingerprintEvent(event({ ...base, fingerprint: ["payments"] }));
		const other = await hash({
			...error("RangeError", "y", [appFrame("save")]),
			fingerprint: ["payments"],
		});
		expect(custom.method).toBe("sdk");
		expect(custom.hash).toBe(other);
		const tenantA = await hash({ ...base, fingerprint: ["{{ default }}", "tenant-a"] });
		const tenantB = await hash({ ...base, fingerprint: ["{{ default }}", "tenant-b"] });
		expect(tenantA).not.toBe(tenantB);
		expect(tenantA).not.toBe(await hash(base));
	});

	it("handles an event with nothing to group by", async () => {
		const result = await fingerprintEvent(event({}));
		expect(result.hash).toMatch(/^[0-9a-f]{32}$/);
	});

	it("is stable for every golden fixture (a change splits issues: needs a new version)", async () => {
		const hashes: Record<string, { method: string; hash: string }> = {};
		for (const fixture of loadSentryFixtures()) {
			const result = await fingerprintEvent(event(rawEventFromFixture(fixture.name)));
			hashes[fixture.name] = { method: result.method, hash: result.hash };
		}
		expect(hashes).toMatchSnapshot();
	});
});

describe("issueTitle", () => {
	it("uses the type and value of the raised error, and the culprit frame", () => {
		const title = issueTitle(event(rawEventFromFixture("node-error-with-cause")));
		expect(title.title).toBe("Error: Failed to start the server");
		expect(title.type).toBe("Error");
	});

	it("uses the message for a message event", () => {
		expect(issueTitle(event(rawEventFromFixture("node-message"))).title).toBe(
			"Cache miss rate above 90% for key user:1234",
		);
	});

	it("names the in-app function where the error was raised", () => {
		const t = issueTitle(event(error("E", "x", [appFrame("outer"), appFrame("inner")])));
		expect(t.culprit).toBe("inner (users)");
	});
});
