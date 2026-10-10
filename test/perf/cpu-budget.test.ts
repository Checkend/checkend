import { describe, expect, it } from "vitest";
import { readIngestBody } from "../../src/core/ingest/body.ts";
import { parseEnvelope } from "../../src/core/ingest/envelope.ts";
import { INGEST_LIMITS } from "../../src/core/ingest/limits.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { rawEventFromFixture } from "../node/ingest/event-from-fixture.ts";
import { maxSizeEvent, worstSdkEvent } from "../support/worst-event.ts";

/**
 * CPU budget (H3). This file runs alone (`npm run test:perf`), not in parallel with other
 * tests, so that the times are stable.
 * the Workers Free plan allows 10 ms of CPU per request, and work in
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

async function medianMs(
	event: Record<string, unknown>,
): Promise<{ median: number; bytes: number }> {
	const text = `{}\n{"type":"event"}\n${JSON.stringify(event)}\n`;
	const body = await gzip(text);
	for (let i = 0; i < 10; i++) await cpuPath(body); // warm up the JIT
	const times: number[] = [];
	for (let i = 0; i < 30; i++) {
		const start = performance.now();
		await cpuPath(body);
		times.push(performance.now() - start);
	}
	times.sort((a, b) => a - b);
	return { median: times[15] ?? Number.POSITIVE_INFINITY, bytes: text.length };
}

describe("CPU budget", () => {
	it("a typical real event (golden fixture): median under 2 ms", async () => {
		const { median, bytes } = await medianMs(rawEventFromFixture("node-type-error"));
		console.log(`typical event: ${bytes} bytes, median ${median.toFixed(2)} ms`);
		expect(median).toBeLessThan(2);
	});

	it("the worst event of a real SDK (default SDK limits): median under 10 ms", async () => {
		const { median, bytes } = await medianMs(worstSdkEvent());
		console.log(`worst SDK event: ${bytes} bytes, median ${median.toFixed(2)} ms`);
		expect(median).toBeLessThan(10);
	});

	// Only a hostile client sends this. On the Free plan, its own request fails; others do not.
	it("the largest event that ingest accepts (any shape): median under 15 ms", async () => {
		const event = maxSizeEvent(INGEST_LIMITS.eventBytes);
		const { median, bytes } = await medianMs(event);
		console.log(`largest accepted event: ${bytes} bytes, median ${median.toFixed(2)} ms`);
		expect(bytes).toBeGreaterThan(INGEST_LIMITS.eventBytes * 0.9);
		expect(median).toBeLessThan(15);
	});
});
