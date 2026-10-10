// Load test: a burst of errors against a LOCAL Checkend (wrangler dev). Never point it at a
// production instance without the owner's approval: it creates a project and sends many events.
//
// Run: node scripts/load-test.ts --url http://127.0.0.1:8788 --token <ADMIN_TOKEN> \
//        [--per-minute 10000] [--seconds 60] [--concurrency 40] [--projects 1]
// Each DSN key has a rate limit (wrangler.jsonc: 1000 per minute), so one project gets 429 above
// it; --projects spreads the burst over several projects to load the write path.
//
// It creates a project, sends events at the rate (90% repeat 20 errors, 10% new errors, random
// users and tags), then checks that the events the API counts equal the accepted requests.
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		url: { type: "string", default: "http://127.0.0.1:8788" },
		token: { type: "string" },
		"per-minute": { type: "string", default: "10000" },
		seconds: { type: "string", default: "60" },
		concurrency: { type: "string", default: "40" },
		projects: { type: "string", default: "1" },
	},
});
const base = values.url as string;
const token = values.token ?? process.env.CHECKEND_ADMIN_TOKEN;
if (!token) throw new Error("Give --token or CHECKEND_ADMIN_TOKEN.");
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) {
	throw new Error("The load test runs against a local Checkend only (http://127.0.0.1:<port>).");
}
const perMinute = Number(values["per-minute"]);
const seconds = Number(values.seconds);
const concurrency = Number(values.concurrency);
const total = Math.round((perMinute * seconds) / 60);

const api = async (method: string, path: string, body?: unknown) => {
	const response = await fetch(`${base}${path}`, {
		method,
		headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	if (!response.ok)
		throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
	return (await response.json()) as { data: Record<string, unknown> & { dsn?: string } };
};

const projects: { id: string; url: string }[] = [];
for (let n = 0; n < Number(values.projects); n++) {
	const created = await api("POST", "/v1/projects", {
		name: `Load test ${n} ${new Date().toISOString()}`,
	});
	const dsn = new URL(created.data.dsn as string);
	const id = dsn.pathname.slice(1);
	projects.push({ id, url: `${base}/api/${id}/store/?sentry_key=${dsn.username}` });
}

const event = (i: number) => {
	const repeat = Math.random() < 0.9;
	const kind = repeat ? `RepeatedError${i % 20}` : `NewError${i}`;
	return {
		event_id: crypto.randomUUID().replace(/-/g, ""),
		level: "error",
		platform: "node",
		release: "load@1",
		user: { id: `user-${Math.floor(Math.random() * 500)}` },
		tags: {
			region: ["eu", "us", "ap"][i % 3] as string,
			browser: i % 7 === 0 ? "Safari" : "Chrome",
		},
		exception: {
			values: [
				{
					type: kind,
					value: `Something failed for order ${i}`,
					stacktrace: {
						frames: [
							{ filename: "src/server.ts", function: "handle", lineno: 10, in_app: true },
							{ filename: "src/orders.ts", function: kind.toLowerCase(), lineno: 42, in_app: true },
						],
					},
				},
			],
		},
	};
};

const statuses = new Map<number, number>();
const latencies: number[] = [];
const started = performance.now();
let next = 0;
const intervalMs = 60_000 / perMinute;

async function worker() {
	while (true) {
		const i = next++;
		if (i >= total) return;
		// Keep to the rate: event i starts at i x interval.
		const wait = started + i * intervalMs - performance.now();
		if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
		const t0 = performance.now();
		let status = 0;
		try {
			const project = projects[i % projects.length] as { url: string };
			const response = await fetch(project.url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(event(i)),
			});
			status = response.status;
			await response.arrayBuffer();
		} catch {
			status = -1;
		}
		latencies.push(performance.now() - t0);
		statuses.set(status, (statuses.get(status) ?? 0) + 1);
	}
}

await Promise.all(Array.from({ length: concurrency }, worker));
const elapsed = (performance.now() - started) / 1000;
latencies.sort((a, b) => a - b);
const pct = (p: number) =>
	latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
const accepted = statuses.get(200) ?? 0;
console.log(
	JSON.stringify(
		{
			sent: total,
			seconds: Number(elapsed.toFixed(1)),
			per_minute_achieved: Math.round((total / elapsed) * 60),
			statuses: Object.fromEntries(statuses),
			latency_ms: {
				p50: pct(0.5).toFixed(1),
				p95: pct(0.95).toFixed(1),
				p99: pct(0.99).toFixed(1),
			},
		},
		null,
		2,
	),
);

// The writes run after the responses: wait until the counts stop changing.
let counted = -1;
for (let attempt = 0; attempt < 30; attempt++) {
	await new Promise((resolve) => setTimeout(resolve, 2000));
	let sum = 0;
	let issues = 0;
	for (const project of projects) {
		let cursor: string | null = null;
		do {
			const page = (await api(
				"GET",
				`/v1/issues?project=${project.id}&limit=100${cursor ? `&cursor=${cursor}` : ""}`,
			)) as unknown as { data: { times_seen: number }[]; next_cursor: string | null };
			for (const issue of page.data) sum += issue.times_seen;
			issues += page.data.length;
			cursor = page.next_cursor;
		} while (cursor);
	}
	if (sum === counted) {
		console.log(JSON.stringify({ issues, events_counted: sum, accepted, match: sum === accepted }));
		process.exit(sum === accepted ? 0 : 1);
	}
	counted = sum;
}
console.log(
	JSON.stringify({
		events_counted: counted,
		accepted,
		match: false,
		note: "counts still changing",
	}),
);
process.exit(1);
