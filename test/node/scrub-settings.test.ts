import { describe, expect, it, vi } from "vitest";
import { processCpuClock } from "../../src/adapters/node/cpu-clock.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { checkScrubPattern } from "../../src/core/scrub-settings.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "scrub-admin-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const send = async (event: Record<string, unknown>) => {
		await app.request(
			`https://checkend.test/api/${project.id}/store/?sentry_key=${project.publicKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(event),
			},
			{ ports: t.ports },
		);
		await t.settle();
		const row = await t.ports.db.first<{ data: string }>(
			sql`SELECT data FROM events ORDER BY id DESC`,
		);
		return JSON.parse(row?.data ?? "{}") as Record<string, any>;
	};
	return { ...t, project, call, send };
}

describe("project scrub settings", () => {
	it("filters the values of literal keys (any case) in the event, tags and request", async () => {
		const { call, send, project } = await setup();
		const set = await call("PATCH", `/v1/projects/${project.slug}`, {
			scrub_keys: ["customer_ref", "X-Internal-Id"],
		});
		expect(set.status).toBe(200);
		expect(set.body.data).toMatchObject({
			scrub_keys: ["customer_ref", "x-internal-id"],
			scrub_patterns: [],
		});
		const event = await send({
			message: "checkout failed",
			extra: { Customer_Ref: "C-991", order: "o-1" },
			tags: { customer_ref: "C-991" },
			request: { url: "https://shop.example/pay", headers: { "X-Internal-Id": "abc" } },
		});
		expect(JSON.stringify(event)).not.toContain("C-991");
		expect(JSON.stringify(event)).not.toContain("abc");
		expect(JSON.stringify(event)).toContain("o-1");
	});

	it("replaces matches of the patterns in all strings, also in the title", async () => {
		const { call, send, project, ports } = await setup();
		const saved = await call("PATCH", `/v1/projects/${project.slug}`, {
			scrub_patterns: ["ORD-\\d{6}"],
		});
		expect(saved.status, `the pattern was not saved: ${JSON.stringify(saved.body)}`).toBe(200);
		await send({ exception: { values: [{ type: "Error", value: "order ORD-123456 failed" }] } });
		const issue = await ports.db.first<{ title: string }>(sql`SELECT title FROM issues`);
		expect(issue?.title).toBe("Error: order [Filtered] failed");
	});

	it("rejects patterns that are invalid, too long, too many, with backreferences, or slow", async () => {
		const { call, project } = await setup();
		const cases: [unknown, RegExp][] = [
			[["(unclosed"], /not a valid/i],
			[["x".repeat(201)], /200/],
			[Array.from({ length: 11 }, (_, i) => `p${i}`), /10/],
			[["(a)\\1"], /backreference/i],
			[["(a+)+$"], /nested quantifier/i],
			[["^(a|a)*$"], /too slow/i],
			[["\\d*\\d*\\d*\\d*z"], /too slow/i],
		];
		for (const [scrub_patterns, reason] of cases) {
			const response = await call("PATCH", `/v1/projects/${project.slug}`, { scrub_patterns });
			expect(response.status, JSON.stringify(scrub_patterns).slice(0, 40)).toBe(400);
			expect(response.body.details[0].message, JSON.stringify(scrub_patterns).slice(0, 40)).toMatch(
				reason,
			);
		}
		for (const scrub_keys of [
			["has space"],
			["x".repeat(65)],
			Array.from({ length: 51 }, (_, i) => `k${i}`),
		]) {
			expect((await call("PATCH", `/v1/projects/${project.slug}`, { scrub_keys })).status).toBe(
				400,
			);
		}
	});

	it("checks a slow pattern in a short time, with the CPU clock of Node", async () => {
		const started = performance.now();
		const tick = async () => {};
		expect((await checkScrubPattern("^(a|a)*$", tick, processCpuClock)).ok).toBe(false);
		expect((await checkScrubPattern("(\\w+\\s?)+$", tick, processCpuClock)).ok).toBe(false);
		expect((await checkScrubPattern("[A-Z]{2}-\\d{4,8}", tick, processCpuClock)).ok).toBe(true);
		expect(performance.now() - started).toBeLessThan(5000);
	});

	it("with a CPU clock, a busy machine (a slow wall clock) does not reject a fast pattern", async () => {
		const now = vi.spyOn(Date, "now");
		let wall = 0;
		now.mockImplementation(() => (wall += 1000)); // every wall-clock read: 1 s later
		try {
			const idle = { now: () => 0 };
			expect(await checkScrubPattern("[A-Z]{2}-\\d{4}", async () => {}, idle)).toEqual({
				ok: true,
			});
			let cpu = 0;
			const busy = { now: () => (cpu += 60) }; // every step: 60 ms of CPU
			expect((await checkScrubPattern("[A-Z]{2}-\\d{4}", async () => {}, busy)).ok).toBe(false);
		} finally {
			now.mockRestore();
		}
	});

	it("on a frozen clock (Workers), times the whole battery between two I/O calls", async () => {
		// Workers: Date.now() changes only at I/O. Here the battery "takes" 300 ms between them.
		let frozen = 1_000_000;
		const now = vi.spyOn(Date, "now").mockImplementation(() => frozen);
		let ticks = 0;
		const ioTick = async () => {
			ticks++;
			if (ticks === 2) frozen += 300;
		};
		try {
			const result = await checkScrubPattern("[A-Z]{2}-\\d{4}", ioTick);
			expect(result).toEqual({ ok: false, reason: "The pattern is too slow on long inputs." });
			expect(ticks).toBe(2);
		} finally {
			now.mockRestore();
		}
		expect(await checkScrubPattern("[A-Z]{2}-\\d{4}", async () => {})).toEqual({ ok: true });
	});
});
