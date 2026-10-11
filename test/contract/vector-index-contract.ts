import { describe, expect, it } from "vitest";
import type { VectorIndex } from "../../src/ports/vector-index.ts";

const unit = (values: number[]) => {
	const norm = Math.hypot(...values);
	return values.map((v) => v / norm);
};

/**
 * The behaviour every VectorIndex adapter must have. `settle` waits until upserts are visible
 * (a fake or SQLite: at once).
 */
export function vectorIndexContract(
	adapterName: string,
	make: () => Promise<{ index: VectorIndex; settle: () => Promise<void> }>,
): void {
	describe(`VectorIndex contract: ${adapterName}`, () => {
		it("finds the closest vectors first, with cosine scores, up to topK", async () => {
			const { index, settle } = await make();
			await index.upsert([
				{ id: "a", values: unit([1, 0, 0, 0]) },
				{ id: "b", values: unit([0.9, 0.1, 0, 0]) },
				{ id: "c", values: unit([0, 1, 0, 0]) },
			]);
			await settle();
			const matches = await index.query(unit([1, 0.05, 0, 0]), 2);
			expect(matches.map((m) => m.id)).toEqual(["a", "b"]);
			expect(matches[0]?.score).toBeGreaterThan(0.99);
			expect(matches[0]?.score).toBeLessThanOrEqual(1.0001);
			const byId = await index.queryById("c", 3);
			expect(byId[0]).toMatchObject({ id: "c" });
			expect(byId[0]?.score).toBeGreaterThan(0.99);
		});

		it("replaces a vector with the same id, and deletes vectors", async () => {
			const { index, settle } = await make();
			await index.upsert([
				{ id: "x", values: unit([1, 0, 0, 0]) },
				{ id: "y", values: unit([0, 0, 1, 0]) },
			]);
			await index.upsert([{ id: "x", values: unit([0, 0, 0, 1]) }]);
			await settle();
			expect((await index.query(unit([0, 0, 0, 1]), 1))[0]?.id).toBe("x");
			await index.deleteByIds(["x"]);
			await settle();
			expect((await index.query(unit([0, 0, 0, 1]), 5)).map((m) => m.id)).not.toContain("x");
			expect(await index.queryById("x", 5)).toEqual([]);
		});
	});
}
