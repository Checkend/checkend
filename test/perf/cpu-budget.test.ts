import { describe, expect, it } from "vitest";
import { readIngestBody } from "../../src/core/ingest/body.ts";
import { parseEnvelope } from "../../src/core/ingest/envelope.ts";
import { INGEST_LIMITS } from "../../src/core/ingest/limits.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { rawEventFromFixture } from "../node/ingest/event-from-fixture.ts";
import { maxSizeEvent, worstSdkEvent } from "../support/worst-event.ts";

/**
 * CPU budget. This file runs alone (`npm run test:perf`), not in parallel with other tests.
 * The Workers Free plan allows 10 ms of CPU per request, and work in
 * waitUntil counts. The whole CPU path: read + decompress, envelope, parse, normalize,
 * scrub, fingerprint, and the raw gzip. Measured in Node as a proxy for workerd (same V8).
 */
const gzip = async (text: string) =>
	new Uint8Array(
		await new Response(
			new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer(),
	);

async function cpuPath(body: Uint8Array<ArrayBuffer>): Promise<void> {
	const request = new Request("https://checkend.test/api/1/envelope/", {
		method: "POST",
		body,
		headers: { "content-encoding": "gzip" },
	});
	const payload = parseEnvelope(await readIngestBody(request)).event;
	if (!payload) throw new Error("no event");
	const prepared = await prepareEvent(payload, new Date());
	if (prepared.rawJson !== null) await gzip(prepared.rawJson);
}

// A fixed task with the same kinds of work as ingest: JSON, regex scans and gzip. A slower
// machine (or a busy CI runner) makes it slower by about the same factor as ingest, so the
// ratio event time / calibration time is stable across machines.
const CALIBRATION_TEXT = JSON.stringify(
	Array.from({ length: 4000 }, (_, i) => ({
		id: i,
		name: `item-${i}`,
		text: "lorem ipsum dolor sit amet, consectetur adipiscing ".repeat(3),
		tags: ["alpha", "beta", "gamma"],
		nested: { x: i, y: [1, 2, 3], z: { deep: `value-${i}` } },
	})),
);

async function calibration(): Promise<void> {
	JSON.stringify(JSON.parse(CALIBRATION_TEXT));
	CALIBRATION_TEXT.replace(/[0-9]+/g, "#").replace(/\b[a-z]{5,}\b/g, (w) => w.toUpperCase());
	await gzip(CALIBRATION_TEXT.slice(0, 200_000));
}

const timed = async (run: () => Promise<void>) => {
	const start = performance.now();
	await run();
	return performance.now() - start;
};

const median = (values: number[]) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;

/**
 * Runs the event and the calibration task in turns, so that both see the same load. Returns
 * the median event time, the median calibration time, and the median of the per-turn ratios.
 */
async function measure(
	event: Record<string, unknown>,
): Promise<{ ms: number; calibrationMs: number; ratio: number; bytes: number }> {
	const text = `{}\n{"type":"event"}\n${JSON.stringify(event)}\n`;
	const body = await gzip(text);
	for (let i = 0; i < 10; i++) {
		await cpuPath(body); // warm up the JIT
		await calibration();
	}
	const times: number[] = [];
	const calibrations: number[] = [];
	const ratios: number[] = [];
	for (let i = 0; i < 30; i++) {
		const eventMs = await timed(() => cpuPath(body));
		const calibrationMs = await timed(calibration);
		times.push(eventMs);
		calibrations.push(calibrationMs);
		ratios.push(eventMs / calibrationMs);
	}
	return {
		ms: median(times),
		calibrationMs: median(calibrations),
		ratio: median(ratios),
		bytes: text.length,
	};
}

const report = (
	label: string,
	m: { ms: number; calibrationMs: number; ratio: number; bytes: number },
) =>
	console.log(
		`${label}: ${m.bytes} bytes; ${m.ms.toFixed(2)} ms; calibration ${m.calibrationMs.toFixed(2)} ms; ratio ${m.ratio.toFixed(3)}`,
	);

/*
 * Limits are ratios to the calibration task, about 1.5x the values measured on 2026-10-10
 * (they were the same on fast and on slow cores: Apple silicon performance cores, and the
 * efficiency cores at about 6x slower). A rise of more than about 50% fails the test on any
 * machine, also on a slow CI runner. Absolute times are printed for humans.
 *   typical 0.05-0.077, worst SDK event 0.41-0.47, largest accepted event 0.51-0.56.
 */
const LIMITS = { typical: 0.15, worstSdk: 0.65, largest: 0.8 };

describe("CPU budget (ratios to a calibration task on the same machine)", () => {
	it(`a typical real event (golden fixture): ratio under ${LIMITS.typical}`, async () => {
		const m = await measure(rawEventFromFixture("node-type-error"));
		report("typical event", m);
		expect(m.ratio).toBeLessThan(LIMITS.typical);
	});

	it(`the worst event of a real SDK (default SDK limits): ratio under ${LIMITS.worstSdk}`, async () => {
		const m = await measure(worstSdkEvent());
		report("worst SDK event", m);
		expect(m.ratio).toBeLessThan(LIMITS.worstSdk);
	});

	// Only a hostile client sends this. On the Free plan, its own request fails; others do not.
	it(`the largest event that ingest accepts (any shape): ratio under ${LIMITS.largest}`, async () => {
		const event = maxSizeEvent(INGEST_LIMITS.eventBytes);
		const m = await measure(event);
		report("largest accepted event", m);
		expect(m.bytes).toBeGreaterThan(INGEST_LIMITS.eventBytes * 0.9);
		expect(m.ratio).toBeLessThan(LIMITS.largest);
	});
});
