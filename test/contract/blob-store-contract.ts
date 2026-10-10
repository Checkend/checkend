import { beforeEach, describe, expect, it } from "vitest";
import type { BlobStore } from "../../src/ports/blob-store.ts";

/**
 * The behaviour every `BlobStore` adapter must have. workerd runs it against R2, Node against
 * the file system and the memory store.
 */
export function blobStoreContract(
	adapterName: string,
	makeStore: () => Promise<BlobStore> | BlobStore,
): void {
	describe(`BlobStore contract: ${adapterName}`, () => {
		let store: BlobStore;
		const prefix = `contract/${crypto.randomUUID()}`;

		beforeEach(async () => {
			store = await makeStore();
		});

		it("stores bytes and reads them back unchanged", async () => {
			const bytes = new Uint8Array([0, 1, 2, 255, 128, 10]);
			await store.put(`${prefix}/a.bin`, bytes);
			expect(await store.get(`${prefix}/a.bin`)).toEqual(bytes);
		});

		it("stores text as UTF-8", async () => {
			await store.put(`${prefix}/t.txt`, "héllo ✓");
			expect(new TextDecoder().decode((await store.get(`${prefix}/t.txt`)) ?? undefined)).toBe(
				"héllo ✓",
			);
		});

		it("returns null for a missing key", async () => {
			expect(await store.get(`${prefix}/missing`)).toBeNull();
		});

		it("replaces a value, and deletes it", async () => {
			await store.put(`${prefix}/r`, "one");
			await store.put(`${prefix}/r`, "two");
			expect(new TextDecoder().decode((await store.get(`${prefix}/r`)) ?? undefined)).toBe("two");
			await store.delete(`${prefix}/r`);
			expect(await store.get(`${prefix}/r`)).toBeNull();
			await store.delete(`${prefix}/r`); // deleting a missing key is not an error
		});

		it("keeps keys with slashes apart", async () => {
			await store.put(`${prefix}/x/y`, "deep");
			await store.put(`${prefix}/x`, "flat");
			expect(new TextDecoder().decode((await store.get(`${prefix}/x/y`)) ?? undefined)).toBe(
				"deep",
			);
			expect(new TextDecoder().decode((await store.get(`${prefix}/x`)) ?? undefined)).toBe("flat");
		});

		it("rejects keys that are not safe paths", async () => {
			for (const key of ["", "../x", "a/../../b", "/abs", "a//b", "a\\b", "a\0b"]) {
				await expect(store.put(key, "x"), JSON.stringify(key)).rejects.toThrow(/key/);
			}
		});
	});
}
