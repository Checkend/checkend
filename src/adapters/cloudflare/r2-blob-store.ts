import { type BlobStore, checkBlobKey, toBytes } from "../../ports/blob-store.ts";

/** BlobStore on an R2 bucket. */
export function r2BlobStore(bucket: Pick<R2Bucket, "put" | "get" | "delete">): BlobStore {
	return {
		async put(key, value) {
			checkBlobKey(key);
			await bucket.put(key, toBytes(value));
		},
		async get(key) {
			checkBlobKey(key);
			const object = await bucket.get(key);
			return object ? new Uint8Array(await object.arrayBuffer()) : null;
		},
		async delete(key) {
			checkBlobKey(key);
			await bucket.delete(key);
		},
	};
}
