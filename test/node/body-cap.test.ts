import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "body-cap-admin-token-0123456789-abcdef";

/** A chunked body (no Content-Length) of `total` bytes; `pulled()` says how much was read. */
function chunked(total: number) {
	let pulled = 0;
	const chunk = new Uint8Array(256 * 1024).fill(32);
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (pulled >= total) return controller.close();
			pulled += chunk.byteLength;
			controller.enqueue(chunk);
		},
	});
	return { body, pulled: () => pulled };
}

describe("body caps on authenticated routes", async () => {
	const { ports } = await testPorts({ config: { adminToken: ADMIN } });
	const app = createApp({ state: new IngestState() });
	const send = (path: string, total: number, headers: Record<string, string> = {}) => {
		const stream = chunked(total);
		const response = app.request(
			new Request(`https://checkend.test${path}`, {
				method: "POST",
				headers: {
					authorization: `Bearer ${ADMIN}`,
					"content-type": "application/json",
					...headers,
				},
				body: stream.body,
				duplex: "half",
			} as RequestInit),
			undefined,
			{ ports },
		);
		return { response, pulled: stream.pulled };
	};

	it.each(["/v1/projects", "/v1/setup/apps", "/mcp"])(
		"%s stops reading a chunked body at 1 MB (413)",
		async (path) => {
			const { response, pulled } = send(path, 64 * 1024 * 1024, {
				accept: "application/json, text/event-stream",
			});
			expect((await response).status).toBe(413);
			expect(pulled()).toBeLessThan(2 * 1024 * 1024);
		},
	);

	it("a normal JSON body still works", async () => {
		const response = await app.request(
			"https://checkend.test/v1/projects",
			{
				method: "POST",
				headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
				body: JSON.stringify({ name: "Shop" }),
			},
			{ ports },
		);
		expect(response.status).toBe(201);
	});

	it("source map uploads keep their own 30 MB cap, also for a chunked body", async () => {
		const { response, pulled } = send(
			"/v1/sourcemaps?project=shop&release=1&name=~/a.js",
			64 * 1024 * 1024,
		);
		expect((await response).status).toBe(413);
		expect(pulled()).toBeLessThan(31 * 1024 * 1024);
		expect(pulled()).toBeGreaterThan(29 * 1024 * 1024);
	});
});
