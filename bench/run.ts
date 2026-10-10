// The real CPU benchmark: sends the golden fixtures and the largest events to the benchmark
// Worker (bench/wrangler.jsonc), and reads the CPU time of each request from `wrangler tail`.
// It never deploys: see bench/README.md for the steps, and who approves the deploy.
//
// Run: node bench/run.ts --url https://checkend-bench.<subdomain>.workers.dev --token <ADMIN_TOKEN>
//        [--repeat 30] [--cold]
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { INGEST_LIMITS } from "../src/core/ingest/limits.ts";
import { loadSentryFixtures } from "../test/fixtures/sentry/load.ts";
import { withKey } from "../test/fixtures/sentry/with-key.ts";
import { maxSizeEvent, worstSdkEvent } from "../test/support/worst-event.ts";
import { jsonObjects, parseTailLine, type Sample, summarize } from "./stats.ts";

const { values } = parseArgs({
	options: {
		url: { type: "string" },
		token: { type: "string" },
		repeat: { type: "string", default: "30" },
		// One request per case, right after a deploy: (mostly) new isolates.
		cold: { type: "boolean", default: false },
	},
});
const base = values.url?.replace(/\/$/, "");
const token = values.token ?? process.env.CHECKEND_BENCH_ADMIN_TOKEN;
if (!base || !token) throw new Error("Give --url (the benchmark Worker) and --token.");
if (!/^https:\/\/checkend-bench\./.test(base)) {
	throw new Error(
		"The URL must be the benchmark Worker (https://checkend-bench.<subdomain>.workers.dev).",
	);
}
const repeat = values.cold ? 1 : Number(values.repeat);

const gzip = async (text: string) =>
	new Uint8Array(
		await new Response(
			new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer(),
	);
const envelope = (event: Record<string, unknown>) =>
	`{}\n{"type":"event"}\n${JSON.stringify({ ...event, event_id: crypto.randomUUID().replace(/-/g, "") })}\n`;

const created = await fetch(`${base}/v1/projects`, {
	method: "POST",
	headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
	body: JSON.stringify({ name: `Benchmark ${new Date().toISOString()}` }),
});
if (!created.ok) throw new Error(`Cannot create the project: ${created.status}`);
const dsn = new URL(((await created.json()) as { data: { dsn: string } }).data.dsn);
const projectId = dsn.pathname.slice(1);
const key = dsn.username;

// The cases: every golden fixture (exact bytes), the worst real SDK event, the largest event.
type Case = { name: string; body: () => Promise<Uint8Array>; headers: Record<string, string> };
const cases: Case[] = [
	...loadSentryFixtures().map((f) => ({
		name: f.name,
		body: async () => f.body,
		headers: withKey(f.headers, key),
	})),
	{
		name: "worst-sdk-event",
		body: () => gzip(envelope(worstSdkEvent())),
		headers: { "content-encoding": "gzip" },
	},
	{
		name: "largest-accepted-event",
		body: () => gzip(envelope(maxSizeEvent(INGEST_LIMITS.eventBytes))),
		headers: { "content-encoding": "gzip" },
	},
];

// Start the tail first, and wait until it is connected.
const tail = spawn(
	"npx",
	["wrangler", "tail", "checkend-bench", "--format", "json", "--config", "bench/wrangler.jsonc"],
	{
		stdio: ["ignore", "pipe", "inherit"],
	},
);
const samples: Sample[] = [];
let lines = 0;
const onLine = jsonObjects((text) => {
	const sample = parseTailLine(text);
	if (sample) samples.push(sample);
});
createInterface({ input: tail.stdout }).on("line", (line) => {
	lines++;
	onLine(line);
});
await new Promise((resolve) => setTimeout(resolve, 8000));

let sent = 0;
for (let round = 0; round < repeat; round++) {
	for (const c of cases) {
		const url = `${base}/api/${projectId}/envelope/?sentry_key=${key}&bench=${encodeURIComponent(c.name)}`;
		const response = await fetch(url, { method: "POST", headers: c.headers, body: await c.body() });
		await response.arrayBuffer();
		sent++;
	}
}
console.log(`Sent ${sent} requests; waiting for the tail...`);
await new Promise((resolve) => setTimeout(resolve, 15000));
tail.kill();

const summary = summarize(samples);
console.table(summary);
console.log(
	JSON.stringify({
		mode: values.cold ? "cold" : "warm",
		sent,
		samples: samples.length,
		tail_lines: lines,
	}),
);
if (samples.length === 0) {
	console.log(
		"No CPU times in the tail output. Read them in the dashboard: Workers Observability, query builder, filter the URL by bench=<case>, CPU time p50/p99/max.",
	);
}
