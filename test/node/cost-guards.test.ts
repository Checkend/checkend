import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule (AGENTS.md, "Cost safety"): code that can run in a hosted install (a Durable Object) must
 * not keep the object awake, because the Cloud pays for each second, and Checkend is open source,
 * so anyone can find such a path and use it against every hosted install. This test finds the
 * constructs that can do it. A new use fails here: review it, then add it to the list with the
 * reason why it ends quickly.
 */
const RUNS_ONLY_OUTSIDE_A_DURABLE_OBJECT = [
	"src/entry/server.ts", // the Node server
	"src/adapters/node/", // Node adapters
	"src/http/ui/assets/client.ts", // browser code
];

const files = readdirSync("src", { recursive: true, encoding: "utf8" })
	.filter((name) => name.endsWith(".ts"))
	.map((name) => join("src", name).replaceAll("\\", "/"))
	.filter((file) => !RUNS_ONLY_OUTSIDE_A_DURABLE_OBJECT.some((prefix) => file.startsWith(prefix)));

/** The code of a file without its comments. */
const code = (file: string) =>
	readFileSync(file, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** The files that match `pattern`. */
const uses = (pattern: RegExp) => files.filter((file) => pattern.test(code(file))).sort();

describe("cost guards for hosted installs", () => {
	it("scans the product code", () => {
		expect(files.length).toBeGreaterThan(50);
		expect(files).toContain("src/entry/durable-object.ts");
	});

	it("has no interval timer and no WebSocket that is not hibernatable", () => {
		expect(uses(/\bsetInterval\s*\(/)).toEqual([]);
		expect(uses(/\bWebSocketPair\b|\.accept\s*\(\s*\)/)).toEqual([]);
	});

	it("calls the network only through ports with a timeout", () => {
		// The HTTP port adds the timeout to every call (withTimeout); the DNS resolver has its own.
		// (Not the fetch handlers of the entries: `fetch(request, ...)`.)
		expect(uses(/(?<![.\w])fetch\s*\((?!request\b)/)).toEqual([
			"src/adapters/cloudflare/resolver.ts",
			"src/ports/http.ts",
		]);
		expect(readFileSync("src/adapters/cloudflare/resolver.ts", "utf8")).toMatch(
			/AbortSignal\.timeout\(/,
		);
	});

	it("uses timers only where they are short or stop the call that they race", () => {
		expect(uses(/\bsetTimeout\s*\(/)).toEqual([
			"src/core/ai/triage.ts", // the brief waits 5 s, then aborts the model call
			"src/core/ingest/store.ts", // retry pauses of milliseconds, at most 3 attempts
			"src/core/scrub-settings.ts", // setTimeout(0): yields to the event loop
		]);
		// A race that stops waiting must also stop the losing call (an AbortController or signal).
		const races = uses(/\bPromise\.race\s*\(/);
		expect(races).toEqual(["src/adapters/cloudflare/model-runner.ts", "src/core/ai/triage.ts"]);
		for (const file of races) expect(readFileSync(file, "utf8"), file).toMatch(/abort/i);
	});

	it("sets alarms and waitUntil only in the entries and the defer port", () => {
		expect(uses(/\.setAlarm\s*\(/)).toEqual(["src/entry/durable-object.ts"]);
		expect(uses(/\.waitUntil\s*\(/)).toEqual([
			"src/adapters/cloudflare/ports.ts",
			"src/entry/durable-object.ts",
			"src/entry/worker.ts",
		]);
	});
});
