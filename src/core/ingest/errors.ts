/** A rejection of untrusted ingest input. `status` is the HTTP status to return. */
export class IngestError extends Error {
	constructor(
		readonly status: 400 | 401 | 403 | 413 | 415 | 429,
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "IngestError";
	}
}
