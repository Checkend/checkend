import { describe, expect, it } from "vitest";
import { jsonObjects, parseTailLine, percentile, summarize } from "../../bench/stats.ts";

const line = (bench: string, cpuTime: number, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		outcome: "ok",
		cpuTime,
		wallTime: cpuTime * 3,
		event: {
			request: {
				url: `https://checkend-bench.example.workers.dev/api/1/envelope/?sentry_key=k&bench=${bench}`,
			},
			response: { status: 200 },
		},
		...extra,
	});

describe("CPU benchmark helpers", () => {
	it("reads the case and the CPU time of a tail line (cpuTime or CPUTimeMs)", () => {
		expect(parseTailLine(line("node-type-error", 2))).toEqual({
			case: "node-type-error",
			cpuMs: 2,
			wallMs: 6,
			status: 200,
			outcome: "ok",
		});
		const logpush = JSON.stringify({
			CPUTimeMs: 4,
			event: { request: { url: "https://x/?bench=b" } },
		});
		expect(parseTailLine(logpush)).toMatchObject({ case: "b", cpuMs: 4 });
	});

	it("ignores lines without a case or a CPU time, and text that is not JSON", () => {
		expect(parseTailLine("Connected to checkend-bench, waiting for logs...")).toBeNull();
		expect(
			parseTailLine(JSON.stringify({ cpuTime: 1, event: { request: { url: "https://x/" } } })),
		).toBeNull();
		expect(
			parseTailLine(JSON.stringify({ event: { request: { url: "https://x/?bench=a" } } })),
		).toBeNull();
	});

	it("computes percentiles by nearest rank", () => {
		const values = Array.from({ length: 100 }, (_, i) => i + 1);
		expect(percentile(values, 50)).toBe(50);
		expect(percentile(values, 99)).toBe(99);
		expect(percentile([7], 99)).toBe(7);
		expect(percentile([], 50)).toBeNaN();
	});

	it("summarizes per case, with the samples above 10 ms and the errors", () => {
		const samples = [
			parseTailLine(line("a", 2)),
			parseTailLine(line("a", 12)),
			parseTailLine(line("a", 4, { outcome: "exceededCpu" })),
			parseTailLine(line("b", 1)),
		].filter((s) => s !== null);
		expect(summarize(samples)).toEqual([
			{ case: "a", samples: 3, p50: 4, p99: 12, max: 12, over10ms: 1, errors: 1 },
			{ case: "b", samples: 1, p50: 1, p99: 1, max: 1, over10ms: 0, errors: 0 },
		]);
	});

	it("joins JSON objects printed over several lines, and skips other text", () => {
		const objects: string[] = [];
		const onLine = jsonObjects((text) => objects.push(text));
		const pretty = JSON.stringify({ a: 1, b: { c: [1, 2] } }, null, 2).split("\n");
		for (const l of ["Connected to checkend-bench", ...pretty, '{"single": true}', "waiting"])
			onLine(l);
		expect(objects.map((o) => JSON.parse(o))).toEqual([
			{ a: 1, b: { c: [1, 2] } },
			{ single: true },
		]);
	});
});
