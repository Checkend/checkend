import { describe, expect, it } from "vitest";
import {
	buildModelInput,
	issueModelInput,
	MAX_STATE_CHARS,
	normalizeForModel,
} from "../../../src/core/ai/model-input.ts";
import type { NormalizedEvent, NormalizedFrame } from "../../../src/core/ingest/normalize.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject, updateProject } from "../../../src/core/projects.ts";
import { compileScrub } from "../../../src/core/scrub-settings.ts";
import { BOOTSTRAP_ADMIN } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";

const frame = (over: Partial<NormalizedFrame>): NormalizedFrame => ({
	filename: null,
	abs_path: null,
	module: null,
	function: null,
	lineno: null,
	colno: null,
	in_app: null,
	context_line: null,
	pre_context: [],
	post_context: [],
	...over,
});

const event = (over: Partial<NormalizedEvent>): NormalizedEvent => ({
	version: 1,
	event_id: "e1",
	timestamp: "2026-10-10T12:00:00Z",
	level: "error",
	platform: "node",
	release: "1.2.3",
	environment: "production",
	server_name: "web-7.internal",
	message: null,
	message_template: null,
	exceptions: [],
	tags: [["customer", "acme"]],
	user: { email: "jane@example.com", id: "42" },
	request: {
		url: "https://shop.example/cart?session=abc",
		method: "POST",
		query_string: "session=abc",
		headers: [["Cookie", "sid=1"]],
	},
	contexts: { os: { name: "Linux" } },
	extra: { card: "4111 1111 1111 1111" },
	breadcrumbs: [
		{ timestamp: null, category: "http", message: "GET /a", level: null, type: null, data: null },
	],
	sdk: null,
	fingerprint: null,
	truncated: false,
	...over,
});

describe("normalizeForModel", () => {
	it("replaces personal and unique values with placeholders", () => {
		expect(
			normalizeForModel(
				"User jane.doe+x@example.com from 203.0.113.9 (2001:db8:0:0:1:0:0:1) order 1234567 id 3f2504e0-4f89-11d3-9a0c-0305e82c3301 hash deadbeefdeadbeef00",
				null,
			),
		).toBe("User <email> from <ip> (<ip>) order <n> id <uuid> hash <hex>");
	});

	it("drops URL query strings and keeps short numbers and times", () => {
		expect(
			normalizeForModel(
				"GET https://api.example/v1/items?token=abc&x=1 at 12:30:45, line 42",
				null,
			),
		).toBe("GET https://api.example/v1/items?<query> at 12:30:45, line 42");
	});

	it("runs the default scrubber and the project patterns again", () => {
		const scrub = compileScrub(null, ["ACME-\\d+"]);
		expect(normalizeForModel("Authorization: Bearer abc.def for ACME-77", scrub)).toBe(
			"Authorization: [Filtered] [Filtered] for [Filtered]",
		);
	});
});

describe("buildModelInput", () => {
	const input = buildModelInput(
		{ title: "TypeError: Cannot read properties of undefined (reading 'id')", level: "error" },
		event({
			exceptions: [
				{
					type: "TypeError",
					value: "Cannot read properties of undefined (reading 'id') for jane@example.com",
					module: null,
					mechanism: null,
					frames: [
						frame({ filename: "node:internal/x", function: "run", in_app: false }),
						frame({
							filename: "/srv/app/src/cart.js",
							function: "total",
							lineno: 12,
							in_app: true,
							context_line: "  return cart.user.id + secret_token;",
						}),
					],
				},
			],
		}),
		null,
	);

	it("keeps only the error: no user, request, tags, extra, contexts, breadcrumbs or server", () => {
		const text = JSON.stringify(input.state);
		for (const absent of [
			"acme",
			"jane",
			"Cookie",
			"session",
			"4111",
			"Linux",
			"GET /a",
			"web-7",
			"1.2.3",
		]) {
			expect(text).not.toContain(absent);
		}
		expect(input.state).toEqual({
			title: "TypeError: Cannot read properties of undefined (reading 'id')",
			level: "error",
			platform: "node",
			environment: "production",
			message: null,
			exceptions: [
				{
					type: "TypeError",
					value: "Cannot read properties of undefined (reading 'id') for <email>",
					frames: [
						{
							function: "total",
							location: "app/src/cart.js",
							line: 12,
							source: "return cart.user.id + secret_token;",
						},
					],
				},
			],
		});
	});

	it("gives a short text for embeddings, built from the same state", () => {
		expect(input.text).toBe(
			"TypeError: Cannot read properties of undefined (reading 'id')\nTypeError: Cannot read properties of undefined (reading 'id') for <email>\n  at total (app/src/cart.js:12)",
		);
	});

	it("stays inside the Clef-flash context even with 1 token per character (CJK text)", () => {
		const cjk = "错误".repeat(400);
		const big = buildModelInput(
			{ title: cjk, level: "error" },
			event({
				message: cjk,
				exceptions: Array.from({ length: 3 }, () => ({
					type: "错误类型",
					value: cjk,
					module: null,
					mechanism: null,
					frames: Array.from({ length: 8 }, (_, i) =>
						frame({
							function: `函数${cjk.slice(0, 100)}${i}`,
							filename: `/srv/${cjk.slice(0, 150)}.js`,
							in_app: true,
							context_line: cjk,
						}),
					),
				})),
			}),
			null,
		);
		expect(JSON.stringify(big.state).length).toBeLessThanOrEqual(MAX_STATE_CHARS);
		expect(MAX_STATE_CHARS + 2000).toBeLessThan(24_576); // the questions need about 600 tokens
		expect(big.state.exceptions[0]?.frames.length).toBeGreaterThan(0);
	});

	it("caps the size of the input", () => {
		const many = buildModelInput(
			{ title: "x".repeat(5000), level: "error" },
			event({
				exceptions: Array.from({ length: 10 }, () => ({
					type: "E",
					value: "v".repeat(5000),
					module: null,
					mechanism: null,
					frames: Array.from({ length: 50 }, (_, i) => frame({ function: `f${i}`, in_app: true })),
				})),
			}),
			null,
		);
		expect(many.state.exceptions).toHaveLength(3);
		expect(many.state.exceptions[0]?.frames).toHaveLength(8);
		expect(JSON.stringify(many.state).length).toBeLessThan(4000);
	});
});

describe("issueModelInput", () => {
	it("reads the issue and its latest event, with the current project scrub settings", async () => {
		const { ports, clock } = await testPorts();
		const project = await createProject(ports, { name: "Shop" });
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify({ message: "Order ORD-991 failed" })),
			clock.now(),
		);
		await storeEvent(ports, new IngestState(), project.internalId, prepared);
		// A pattern added after the event was stored still applies to the model input.
		await updateProject(ports, BOOTSTRAP_ADMIN, project.slug, { scrub_patterns: ["ORD-\\d+"] });
		const issue = await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`);
		const input = await issueModelInput(ports.db, issue?.id ?? 0);
		expect(input?.state.title).toBe("Order [Filtered] failed");
		expect(input?.state.message).toBe("Order [Filtered] failed");
		expect(await issueModelInput(ports.db, 999)).toBeNull();
	});
});
