/**
 * Limits for untrusted ingest input. They protect the CPU budget (10 ms on the Workers Free
 * plan), memory, and D1 (2 MB per row, 100 KB per statement).
 */
export const INGEST_LIMITS = {
	/** Request body as sent, before decompression. */
	compressedBytes: 1024 * 1024,
	/** Request body after decompression. Stops gzip bombs. */
	decompressedBytes: 2 * 1024 * 1024,
	/** One event payload, like Sentry's limit. Keeps the CPU path under the 10 ms budget. */
	eventBytes: 1024 * 1024,
	/** The raw payload is kept (for re-processing) only up to this size. */
	rawBytes: 256 * 1024,
	/** Items in one envelope. */
	envelopeItems: 100,
	/** Nesting depth of a JSON payload. */
	jsonDepth: 64,
} as const;
