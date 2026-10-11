import type { VectorIndex } from "../../ports/vector-index.ts";

/** The part of the Vectorize binding that Checkend uses. */
export interface VectorizeBinding {
	upsert(vectors: { id: string; values: number[] }[]): Promise<unknown>;
	query(
		vector: number[],
		options: { topK: number },
	): Promise<{ matches: { id: string; score: number }[] }>;
	queryById(
		id: string,
		options: { topK: number },
	): Promise<{ matches: { id: string; score: number }[] }>;
	deleteByIds(ids: string[]): Promise<unknown>;
}

/**
 * VectorIndex on a Vectorize index (binding VECTORIZE; dimensions 1024, metric cosine, for
 * @cf/qwen/qwen3-embedding-0.6b). Checkend never creates the index: the owner does.
 */
export function vectorizeIndex(binding: VectorizeBinding): VectorIndex {
	const matches = (result: { matches: { id: string; score: number }[] }) =>
		result.matches.map(({ id, score }) => ({ id, score }));
	return {
		async upsert(items) {
			if (items.length > 0) await binding.upsert(items);
		},
		query: async (values, topK) => matches(await binding.query(values, { topK })),
		async queryById(id, topK) {
			try {
				return matches(await binding.queryById(id, { topK }));
			} catch {
				// An unknown id.
				return [];
			}
		},
		async deleteByIds(ids) {
			if (ids.length > 0) await binding.deleteByIds(ids);
		},
	};
}
