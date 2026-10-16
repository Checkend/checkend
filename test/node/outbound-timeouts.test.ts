import { describe, expect, it, vi } from "vitest";
import { cloudflareModelRunner } from "../../src/adapters/cloudflare/model-runner.ts";
import { triageForBrief } from "../../src/core/ai/triage.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { fetchClient, type HttpClient, withTimeout } from "../../src/ports/http.ts";
import type { ModelRunner } from "../../src/ports/model-runner.ts";
import { testPorts } from "../support/node-ports.ts";

/** A server that never answers: the call ends only when its signal aborts. */
function hangingClient() {
	const seen: AbortSignal[] = [];
	const client: HttpClient = {
		send: (_url, init) =>
			new Promise((_resolve, reject) => {
				const signal = init.signal as AbortSignal;
				seen.push(signal);
				signal.addEventListener("abort", () => reject(signal.reason));
			}),
	};
	return { client, seen };
}

describe("outbound HTTP calls always end (a hosted install must not stay awake)", () => {
	it("aborts a call without a signal after the timeout", async () => {
		const { client, seen } = hangingClient();
		const started = Date.now();
		await expect(withTimeout(client, 30).send("https://slow.example/", {})).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(1000);
		expect(seen[0]?.aborted).toBe(true);
	});

	it("keeps a shorter signal of the caller, and still ends at the timeout with a longer one", async () => {
		const { client } = hangingClient();
		const timed = withTimeout(client, 30);
		const caller = new AbortController();
		const call = timed.send("https://slow.example/", { signal: caller.signal });
		caller.abort(new Error("caller stopped"));
		await expect(call).rejects.toThrow("caller stopped");
		const started = Date.now();
		await expect(
			timed.send("https://slow.example/", { signal: AbortSignal.timeout(60_000) }),
		).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it("gives the runtime fetch a timeout", async () => {
		const original = globalThis.fetch;
		let signal: AbortSignal | null | undefined;
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			signal = init.signal;
			return new Response("ok");
		}) as typeof fetch;
		try {
			await fetchClient.send("https://example.com/", { method: "POST" });
		} finally {
			globalThis.fetch = original;
		}
		expect(signal).toBeInstanceOf(AbortSignal);
	});
});

describe("model calls always end", () => {
	it("Workers AI binding: passes a signal that ends at the timeout and with the caller", async () => {
		const seen: (AbortSignal | undefined)[] = [];
		const binding = {
			run: (_m: string, _i: Record<string, unknown>, options: { signal?: AbortSignal }) =>
				new Promise((_resolve, reject) => {
					seen.push(options.signal);
					options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
				}),
		};
		const runner = cloudflareModelRunner(binding, { id: "default", collectLog: false }, 30);
		await expect(runner.run("@cf/cloudflare/clef-flash", {})).rejects.toThrow();
		expect(seen[0]?.aborted).toBe(true);
		const caller = new AbortController();
		const call = runner.run("@cf/cloudflare/clef-flash", {}, { signal: caller.signal });
		caller.abort(new Error("caller stopped"));
		await expect(call).rejects.toThrow("caller stopped");
	});

	it("the brief stops the triage call when it stops waiting (no call left open)", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const signals: (AbortSignal | undefined)[] = [];
			const models: ModelRunner = {
				run: (_model, _input, options) =>
					new Promise((_resolve, reject) => {
						signals.push(options?.signal);
						options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
					}),
			};
			const t = await testPorts({ models });
			const ports = {
				...t.ports,
				config: { ...t.ports.config, ai: { ...t.ports.config.ai, triage: true } },
			};
			const project = await createProject(ports, { name: "Shop" });
			const prepared = await prepareEvent(
				new TextEncoder().encode('{"message":"TypeError: x is undefined"}'),
				t.clock.now(),
			);
			await storeEvent(ports, new IngestState(), project.internalId, prepared, {
				sleep: async () => {},
			});
			const issueId = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
			const done = triageForBrief(ports, issueId);
			await vi.advanceTimersByTimeAsync(6000);
			await done;
			expect(signals.length).toBeGreaterThan(0);
			expect(signals.every((s) => s?.aborted === true)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
