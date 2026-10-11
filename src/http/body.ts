import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./app.ts";

/**
 * Reads a request body with a byte cap. It stops reading as soon as the cap is passed, also for a
 * chunked body without Content-Length, so a large body never sits in memory. Null: too large.
 */
export async function readCappedBody(
	request: Request,
	max: number,
): Promise<Uint8Array<ArrayBuffer> | null> {
	const declared = Number(request.headers.get("content-length") ?? Number.NaN);
	if (declared > max) return null;
	if (!request.body) return new Uint8Array(0);
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			length += value.byteLength;
			if (length > max) {
				await reader.cancel().catch(() => {});
				return null;
			}
			chunks.push(value);
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

/** The body cap of authenticated JSON routes: far above any valid request. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * Caps the request body of the routes after it, by stream (also a chunked body): 413 above the
 * cap. The handler then reads the buffered body as usual. `capFor` gives the cap of a path.
 */
export function bodyCap(capFor: (path: string) => number): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		if (c.req.method === "GET" || c.req.method === "HEAD" || !c.req.raw.body) return next();
		const max = capFor(c.req.path);
		const body = await readCappedBody(c.req.raw, max);
		if (!body) return c.json({ error: "payload_too_large", max_bytes: max }, 413);
		c.req.raw = new Request(c.req.raw, { body });
		return next();
	};
}
