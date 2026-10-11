/**
 * A vector index for similar issues (AI_SIMILAR). Cloudflare: Vectorize (optional binding).
 * Node: an exact search in SQLite. Scores are cosine similarity: 1 is the same direction.
 * A Vectorize upsert is visible to queries a few seconds later, not at once.
 */
export interface VectorMatch {
	id: string;
	score: number;
}

export interface VectorIndex {
	/** Adds or replaces vectors (same id: replaced). */
	upsert(items: { id: string; values: number[] }[]): Promise<void>;
	/** The closest vectors to `values`, the closest first. */
	query(values: number[], topK: number): Promise<VectorMatch[]>;
	/** The closest vectors to a stored vector (the vector itself is usually the first match). */
	queryById(id: string, topK: number): Promise<VectorMatch[]>;
	deleteByIds(ids: string[]): Promise<void>;
}

/** Vectorize allows at most 50 matches with metadata and 100 without; Checkend asks for less. */
export const MAX_TOP_K = 50;
