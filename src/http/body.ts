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
