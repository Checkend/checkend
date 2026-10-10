import { describe, expect, it } from "vitest";
import { demoEvents, isLocalUrl, run } from "../../scripts/demo.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const TOKEN = "demo-test-token-0123456789";
const NOW = new Date("2026-10-10T12:00:00Z");

async function setup(devMode = true) {
	const t = await testPorts({ config: { adminToken: TOKEN, devMode } });
	const app = createApp({ state: new IngestState() });
	const requests: string[] = [];
	// The script's fetch goes into the app in memory; deferred writes finish before the answer.
	const fetchFn = async (input: string | URL | Request, init?: RequestInit) => {
		requests.push(String(input));
		const response = await app.request(String(input), init, { ports: t.ports });
		await t.settle();
		return response;
	};
	const lines: string[] = [];
	const demo = (argv: string[], env: Record<string, string | undefined> = {}) =>
		run(argv, { CHECKEND_ADMIN_TOKEN: TOKEN, ...env }, fetchFn, (line) => lines.push(line), NOW);
	return { ...t, demo, lines, requests };
}

describe("npm run demo: local URLs only", () => {
	it.each([
		["http://localhost:8787", true],
		["http://127.0.0.1:8787", true],
		["http://[::1]:8787", true],
		["https://checkend.example.workers.dev", false],
		["http://localhost.evil.example", false],
		["http://10.0.0.5:8787", false],
		["http://user@evil.example/?localhost", false],
		["file:///etc/passwd", false],
		["not a url", false],
	])("%s → %s", (url, allowed) => {
		expect(isLocalUrl(url)).toBe(allowed);
	});

	it("refuses a URL that is not local, before any request", async () => {
		const { demo, lines, requests } = await setup();
		expect(await demo(["--url", "https://checkend.example.workers.dev"])).toBe(1);
		expect(requests).toEqual([]);
		expect(lines.join("\n")).toContain("only sends to localhost");
	});

	it("needs the admin token", async () => {
		const { demo, lines } = await setup();
		expect(await demo(["--url", "http://localhost:8787"], { CHECKEND_ADMIN_TOKEN: "" })).toBe(1);
		expect(lines.join("\n")).toContain("ADMIN_TOKEN");
	});
});

describe("npm run demo", () => {
	it("creates a Demo project and sends events through ingest, spread over past days", async () => {
		const { demo, ports, lines } = await setup();
		expect(await demo(["--url", "http://localhost:8787"])).toBe(0);
		const projects = await ports.db.all(sql`SELECT name, slug FROM projects`);
		expect(projects).toEqual([{ name: "Demo", slug: "demo" }]);
		const issues = await ports.db.all<{ type: string; first_seen: string; last_seen: string }>(
			sql`SELECT type, first_seen, last_seen FROM issues`,
		);
		expect(issues.length).toBeGreaterThanOrEqual(10);
		const firstSeen = issues.map((i) => Date.parse(i.first_seen));
		expect(NOW.getTime() - Math.min(...firstSeen)).toBeGreaterThan(10 * 86400_000);
		// Some issues stopped days ago (they look resolved).
		expect(issues.some((i) => NOW.getTime() - Date.parse(i.last_seen) > 3 * 86400_000)).toBe(true);
		expect(lines.join("\n")).toMatch(/Sent \d+ events/);
	});

	it("reuses the Demo project on a second run", async () => {
		const { demo, ports } = await setup();
		await demo(["--url", "http://localhost:8787", "--days", "2"]);
		await demo(["--url", "http://localhost:8787", "--days", "2"]);
		expect(await ports.db.all(sql`SELECT slug FROM projects`)).toEqual([{ slug: "demo" }]);
	});

	it("warns when the server ignores the demo time (no development mode)", async () => {
		const { demo, lines } = await setup(false);
		expect(await demo(["--url", "http://localhost:8787", "--days", "2"])).toBe(0);
		expect(lines.join("\n")).toContain("npm run dev");
	});
});

describe("demo events", () => {
	const events = demoEvents(NOW, 14);
	const exceptionType = (e: Record<string, unknown>) =>
		(e.exception as { values: { type: string }[] } | undefined)?.values.at(-1)?.type ?? "message";

	it("has several error types, releases, environments and platforms", () => {
		expect(new Set(events.map((e) => exceptionType(e.event))).size).toBeGreaterThanOrEqual(8);
		expect(new Set(events.map((e) => e.event.release))).toEqual(
			new Set(["shop@2.3.1", "shop@2.4.0", "shop@2.4.1"]),
		);
		expect(new Set(events.map((e) => e.event.environment))).toEqual(
			new Set(["production", "staging"]),
		);
		expect(new Set(events.map((e) => e.event.platform))).toEqual(new Set(["node", "javascript"]));
	});

	it("is in time order, inside the last 14 days, with a spike", () => {
		const times = events.map((e) => Date.parse(e.at));
		expect(times).toEqual([...times].sort((a, b) => a - b));
		expect(Math.min(...times)).toBeGreaterThanOrEqual(NOW.getTime() - 14 * 86400_000);
		expect(Math.max(...times)).toBeLessThanOrEqual(NOW.getTime());
		const perDay = new Map<string, number>();
		for (const e of events) perDay.set(e.at.slice(0, 10), (perDay.get(e.at.slice(0, 10)) ?? 0) + 1);
		const counts = [...perDay.values()].sort((a, b) => a - b);
		const median = counts[Math.floor(counts.length / 2)] ?? 0;
		expect(Math.max(...counts)).toBeGreaterThan(2 * median);
	});

	it("stays below the local rate limit of 1000 events a minute", () => {
		expect(events.length).toBeLessThan(1000);
	});
});
