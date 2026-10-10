import { describe, expect, it } from "vitest";
import { readIngestBody } from "../../../src/core/ingest/body.ts";
import { IngestError } from "../../../src/core/ingest/errors.ts";
import { INGEST_LIMITS } from "../../../src/core/ingest/limits.ts";

const gzip = async (bytes: Uint8Array<ArrayBuffer>) =>
	new Uint8Array(
		await new Response(
			new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer(),
	);

const post = (
	body: Exclude<ConstructorParameters<typeof Response>[0], undefined>,
	headers: Record<string, string> = {},
) => new Request("https://checkend.test/api/1/envelope/", { method: "POST", body, headers });

async function rejection(promise: Promise<unknown>): Promise<IngestError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof IngestError) return error;
		throw error;
	}
	throw new Error("expected an IngestError");
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe("readIngestBody", () => {
	it("reads a plain body", async () => {
		expect(text(await readIngestBody(post("hello")))).toBe("hello");
	});

	it("decompresses gzip and deflate bodies", async () => {
		const body = await gzip(new TextEncoder().encode("hello gzip"));
		expect(text(await readIngestBody(post(body, { "content-encoding": "gzip" })))).toBe(
			"hello gzip",
		);
		const deflated = new Uint8Array(
			await new Response(
				new Blob(["hello deflate"]).stream().pipeThrough(new CompressionStream("deflate")),
			).arrayBuffer(),
		);
		expect(text(await readIngestBody(post(deflated, { "content-encoding": "deflate" })))).toBe(
			"hello deflate",
		);
	});

	it.each([
		[undefined],
		["application/x-sentry-envelope"],
		["text/plain;charset=UTF-8"],
		["application/json"],
		["application/octet-stream"],
	])("accepts content type %s", async (type) => {
		const headers: Record<string, string> = type ? { "content-type": type } : {};
		expect(text(await readIngestBody(post("x", headers)))).toBe("x");
	});

	it("rejects other content types with 415", async () => {
		const error = await rejection(readIngestBody(post("x", { "content-type": "text/html" })));
		expect(error.status).toBe(415);
	});

	it("rejects an unknown content encoding with 415", async () => {
		const error = await rejection(readIngestBody(post("x", { "content-encoding": "br" })));
		expect(error.status).toBe(415);
	});

	it("rejects a declared Content-Length above the cap before it reads the body", async () => {
		let pulled = false;
		const stream = new ReadableStream(
			{
				pull() {
					pulled = true;
				},
			},
			{ highWaterMark: 0 },
		);
		const request = new Request("https://checkend.test/", {
			method: "POST",
			body: stream,
			headers: { "content-length": String(INGEST_LIMITS.compressedBytes + 1) },
			duplex: "half",
		} as RequestInit);
		const error = await rejection(readIngestBody(request));
		expect(error.status).toBe(413);
		expect(pulled).toBe(false);
	});

	it("rejects a body above the cap when there is no Content-Length", async () => {
		const chunk = new Uint8Array(64 * 1024);
		let sent = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				controller.enqueue(chunk);
				sent += chunk.length;
				if (sent > INGEST_LIMITS.compressedBytes * 4) controller.close();
			},
		});
		const request = new Request("https://checkend.test/", {
			method: "POST",
			body: stream,
			duplex: "half",
		} as RequestInit);
		const error = await rejection(readIngestBody(request));
		expect(error.status).toBe(413);
		expect(sent).toBeLessThan(INGEST_LIMITS.compressedBytes * 2);
	});

	it("stops a gzip bomb at the decompressed cap", async () => {
		const bomb = await gzip(new Uint8Array(INGEST_LIMITS.decompressedBytes * 4));
		expect(bomb.length).toBeLessThan(INGEST_LIMITS.compressedBytes);
		const error = await rejection(readIngestBody(post(bomb, { "content-encoding": "gzip" })));
		expect(error.status).toBe(413);
	});

	it("rejects a corrupt gzip body with 400", async () => {
		const error = await rejection(
			readIngestBody(post(new Uint8Array([1, 2, 3, 4]), { "content-encoding": "gzip" })),
		);
		expect(error.status).toBe(400);
	});

	it("rejects an empty body with 400", async () => {
		const error = await rejection(readIngestBody(post(null)));
		expect(error.status).toBe(400);
	});
});
