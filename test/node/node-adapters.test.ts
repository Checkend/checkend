import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientIpResolver } from "../../src/adapters/node/client-ip.ts";
import { nodeDefer } from "../../src/adapters/node/defer.ts";
import { pinnedHttpClient } from "../../src/adapters/node/http-client.ts";
import { tokenBucketLimiter } from "../../src/adapters/node/rate-limiter.ts";
import { fetchClient } from "../../src/ports/http.ts";
import { httpClientContract } from "../contract/http-client-contract.ts";
import { rateLimiterContract } from "../contract/rate-limiter-contract.ts";

rateLimiterContract("token bucket (Node)", 20, () =>
	tokenBucketLimiter({ limit: 20, periodMs: 60_000 }),
);
// The echo server of the HttpClient contract.
let base = "";
const server = createServer((request, response) => {
	let body = "";
	request.on("data", (chunk: Buffer) => {
		body += chunk.toString("utf8");
	});
	request.on("end", () => {
		if (request.url === "/redirect") {
			response.writeHead(302, { location: "/elsewhere" }).end();
			return;
		}
		response.writeHead(201, {
			"content-type": "application/json",
			"x-echo": String(request.headers["x-test"] ?? ""),
		});
		response.end(JSON.stringify({ method: request.method, body }));
	});
});
beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
	server.close();
});
httpClientContract("fetch (Workers and Node)", fetchClient, () => base);
httpClientContract("pinned (Node)", pinnedHttpClient({ allowPrivate: true }), () => base);

describe("token bucket", () => {
	it("refills over time", async () => {
		let t = 0;
		const limiter = tokenBucketLimiter({ limit: 2, periodMs: 1000, now: () => t });
		expect([await limiter.allow("k"), await limiter.allow("k"), await limiter.allow("k")]).toEqual([
			true,
			true,
			false,
		]);
		t = 500;
		expect(await limiter.allow("k")).toBe(true);
		expect(await limiter.allow("k")).toBe(false);
	});
});

describe("pinned HTTP client (DNS rebinding)", () => {
	it("refuses a host whose lookup gives a private address, at connect time", async () => {
		const client = pinnedHttpClient({
			lookup: ((
				_host: string,
				_options: unknown,
				callback: (e: null, a: { address: string; family: number }[]) => void,
			) => callback(null, [{ address: "127.0.0.1", family: 4 }])) as never,
		});
		await expect(
			client.send("http://rebind.example/hook", { method: "POST", body: "x" }),
		).rejects.toThrow(/private address \(127\.0\.0\.1\)/);
	});

	it("refuses when one of several addresses is private", async () => {
		const client = pinnedHttpClient({
			lookup: ((
				_host: string,
				_options: unknown,
				callback: (e: null, a: { address: string; family: number }[]) => void,
			) =>
				callback(null, [
					{ address: "93.184.216.34", family: 4 },
					{ address: "10.0.0.5", family: 4 },
				])) as never,
		});
		await expect(client.send("http://mixed.example/", { method: "GET" })).rejects.toThrow(
			/private address/,
		);
	});
});

describe("client IP behind proxies", () => {
	const request = (xff?: string) =>
		new Request("http://x/", { headers: xff ? { "x-forwarded-for": xff } : {} });

	it("uses the socket address without TRUSTED_PROXIES, and ignores X-Forwarded-For", () => {
		const resolve = clientIpResolver(undefined);
		expect(resolve("203.0.113.7", request("1.2.3.4"))).toBe("203.0.113.7");
		expect(resolve("::ffff:203.0.113.7", request())).toBe("203.0.113.7");
	});

	it("reads X-Forwarded-For from the right, only through trusted proxies", () => {
		const resolve = clientIpResolver("loopback, 10.0.0.0/8");
		// A client that sends its own header cannot choose its address.
		expect(resolve("127.0.0.1", request("6.6.6.6, 198.51.100.4, 10.1.2.3"))).toBe("198.51.100.4");
		expect(resolve("198.51.100.9", request("1.1.1.1"))).toBe("198.51.100.9");
		expect(resolve("127.0.0.1", request("10.0.0.1, 10.0.0.2"))).toBe("10.0.0.1");
		expect(resolve("127.0.0.1", request("not-an-ip"))).toBe("127.0.0.1");
	});

	it("rejects an invalid TRUSTED_PROXIES entry", () => {
		expect(() => clientIpResolver("10.0.0.0/8, nonsense")).toThrow(/not an address/);
	});
});

describe("defer on Node", () => {
	it("drain waits for all background work, also work that a task starts", async () => {
		const { defer, drain, pending } = nodeDefer();
		const done: string[] = [];
		defer(
			new Promise<void>((resolve) =>
				setTimeout(() => {
					done.push("a");
					defer(new Promise<void>((r) => setTimeout(() => (done.push("b"), r()), 10)));
					resolve();
				}, 10),
			),
		);
		defer(Promise.reject(new Error("logged, not thrown")));
		expect(pending()).toBe(2);
		await drain();
		expect(done).toEqual(["a", "b"]);
		expect(pending()).toBe(0);
	});
});
