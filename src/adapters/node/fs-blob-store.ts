import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type BlobStore, checkBlobKey, toBytes } from "../../ports/blob-store.ts";

/**
 * BlobStore in a directory. A value is a file at <root>/<key>.blob, so that a key and a longer
 * key with the same prefix ("x" and "x/y") do not collide. Writes go to a temporary file first,
 * then a rename, so that a reader never sees half a value.
 */
export function fsBlobStore(root: string): BlobStore {
	const path = (key: string) => {
		checkBlobKey(key);
		return join(root, `${key}.blob`);
	};
	return {
		async put(key, value) {
			const file = path(key);
			await mkdir(dirname(file), { recursive: true });
			const temporary = `${file}.${crypto.randomUUID()}.tmp`;
			await writeFile(temporary, toBytes(value));
			await rename(temporary, file);
		},
		async get(key) {
			try {
				return new Uint8Array(await readFile(path(key)));
			} catch (error) {
				if ((error as { code?: string }).code === "ENOENT") return null;
				throw error;
			}
		},
		async delete(key) {
			await rm(path(key), { force: true });
		},
		async deleteMany(keys) {
			const paths = keys.map(path);
			await Promise.all(paths.map((file) => rm(file, { force: true })));
		},
	};
}
