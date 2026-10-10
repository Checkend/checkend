/** A rejection of untrusted ingest input. `status` is the HTTP status to return. */
export class IngestError extends Error {
	// Plain fields, not parameter properties: Node type stripping does not support those.
	readonly status: 400 | 401 | 403 | 413 | 415 | 429;
	readonly code: string;

	constructor(status: 400 | 401 | 403 | 413 | 415 | 429, code: string, message: string) {
		super(message);
		this.name = "IngestError";
		this.status = status;
		this.code = code;
	}
}
