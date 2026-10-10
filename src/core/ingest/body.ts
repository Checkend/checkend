import { IngestError } from "./errors.ts";
import { INGEST_LIMITS } from "./limits.ts";

// Sentry SDKs send these. The Node SDK sends no Content-Type; browsers send text/plain.
const CONTENT_TYPES = new Set([
	"",
	"application/x-sentry-envelope",
	"text/plain",
	"application/json",
	"application/octet-stream",
]);
const ENCODINGS = new Map<string, "gzip" | "deflate" | null>([
	["", null],
	["identity", null],
	["gzip", "gzip"],
	["x-gzip", "gzip"],
	["deflate", "deflate"],
]);

/**
 * Reads an ingest request body with size caps (untrusted input, layer 1). It checks the
 * content type, the encoding and the declared length before it reads anything, and it stops
 * reading as soon as a cap is reached, also during decompression.
 */
export async function readIngestBody(
	request: Request,
	limits: { compressedBytes: number; decompressedBytes: number } = INGEST_LIMITS,
): Promise<Uint8Array> {
	const type = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
	if (!CONTENT_TYPES.has(type ?? "")) {
		throw new IngestError(415, "unsupported_content_type", "Unsupported Content-Type.");
	}
	const encoding = (request.headers.get("content-encoding") ?? "").trim().toLowerCase();
	const format = ENCODINGS.get(encoding);
	if (format === undefined) {
		throw new IngestError(415, "unsupported_encoding", "Unsupported Content-Encoding.");
	}
	const declared = Number(request.headers.get("content-length") ?? Number.NaN);
	if (declared > limits.compressedBytes) {
		throw new IngestError(413, "body_too_large", "The request body is too large.");
	}
	if (!request.body) throw new IngestError(400, "empty_body", "The request body is empty.");

	let stream = request.body.pipeThrough(byteLimit(limits.compressedBytes));
	if (format) {
		stream = stream
			.pipeThrough(new DecompressionStream(format) as ReadableWritablePair<Uint8Array, Uint8Array>)
			.pipeThrough(byteLimit(limits.decompressedBytes));
	}

	let bytes: Uint8Array;
	try {
		bytes = await collect(stream);
	} catch (error) {
		if (error instanceof IngestError) throw error;
		throw new IngestError(400, "invalid_body", "The request body cannot be decompressed.");
	}
	if (bytes.length === 0) throw new IngestError(400, "empty_body", "The request body is empty.");
	return bytes;
}

function byteLimit(max: number): TransformStream<Uint8Array, Uint8Array> {
	let total = 0;
	return new TransformStream({
		transform(chunk, controller) {
			total += chunk.byteLength;
			if (total > max) {
				controller.error(new IngestError(413, "body_too_large", "The request body is too large."));
				return;
			}
			controller.enqueue(chunk);
		},
	});
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let length = 0;
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			length += value.byteLength;
		}
	} finally {
		reader.releaseLock();
	}
	const out = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
