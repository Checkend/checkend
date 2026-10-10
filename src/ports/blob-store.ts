/**
 * Storage for large values that do not belong in the database (source map indexes and source
 * files). Keys are relative paths: segments of [A-Za-z0-9._@=+-] separated by "/".
 * Adapters: R2 (`adapters/cloudflare`), the file system (`adapters/node`), and the memory store
 * below (tests).
 */
export interface BlobStore {
	put(key: string, value: Uint8Array | string): Promise<void>;
	/** The value, or null when there is none. */
	get(key: string): Promise<Uint8Array | null>;
	/** Deletes the value; a missing key is not an error. */
	delete(key: string): Promise<void>;
	/** Deletes up to 1000 values in one call (R2 counts it as one operation). */
	deleteMany(keys: string[]): Promise<void>;
}

const SEGMENT = /^[A-Za-z0-9._@=+-]{1,200}$/;

/** Throws when the key is not a safe relative path. Every adapter calls it. */
export function checkBlobKey(key: string): void {
	const segments = key.split("/");
	if (key.length > 1024 || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) {
		throw new TypeError(`Invalid blob key: ${JSON.stringify(key.slice(0, 100))}.`);
	}
}

export const toBytes = (value: Uint8Array | string): Uint8Array =>
	typeof value === "string" ? new TextEncoder().encode(value) : value;

/** A BlobStore in memory. For tests. */
export function memoryBlobStore(): BlobStore {
	const values = new Map<string, Uint8Array>();
	return {
		async put(key, value) {
			checkBlobKey(key);
			values.set(key, toBytes(value).slice());
		},
		async get(key) {
			checkBlobKey(key);
			return values.get(key)?.slice() ?? null;
		},
		async delete(key) {
			checkBlobKey(key);
			values.delete(key);
		},
		async deleteMany(keys) {
			for (const key of keys) checkBlobKey(key);
			for (const key of keys) values.delete(key);
		},
	};
}
