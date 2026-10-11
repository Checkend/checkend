import { applyD1Migrations, env } from "cloudflare:test";
import { d1Db } from "../../src/adapters/cloudflare/d1-db.ts";
import {
	type VectorizeBinding,
	vectorizeIndex,
} from "../../src/adapters/cloudflare/vector-index.ts";
import { sqliteVectorIndex } from "../../src/adapters/node/vector-index.ts";
import { vectorIndexContract } from "../contract/vector-index-contract.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

// Miniflare has no local Vectorize: a fake binding with the Vectorize API and its errors
// (queryById of an unknown id throws). The same exact search, so the contract checks the adapter.
function fakeVectorize(): VectorizeBinding {
	const vectors = new Map<string, number[]>();
	const cosine = (a: number[], b: number[]) => {
		let dot = 0;
		let na = 0;
		let nb = 0;
		a.forEach((x, i) => {
			const y = b[i] ?? 0;
			dot += x * y;
			na += x * x;
			nb += y * y;
		});
		return dot / Math.sqrt(na * nb);
	};
	const query = (v: number[], topK: number) => ({
		matches: [...vectors]
			.map(([id, values]) => ({ id, score: cosine(v, values) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK),
	});
	return {
		async upsert(items) {
			for (const item of items) vectors.set(item.id, item.values);
			return { mutationId: "m" };
		},
		query: async (v, { topK }) => query(v, topK),
		async queryById(id, { topK }) {
			const v = vectors.get(id);
			if (!v) throw new Error("VECTOR_QUERY_ERROR (code = 40007): vector not found");
			return query(v, topK);
		},
		async deleteByIds(ids) {
			for (const id of ids) vectors.delete(id);
			return { mutationId: "m" };
		},
	};
}

vectorIndexContract("Vectorize binding (fake, Workers)", async () => ({
	index: vectorizeIndex(fakeVectorize()),
	settle: async () => {},
}));
// The SQLite index on D1 runs too (the same SQL), although Workers use Vectorize.
vectorIndexContract("SQLite exact search on D1 (Workers)", async () => {
	const db = d1Db(env.DB);
	await db.run({ sql: "DELETE FROM vectors", params: [] });
	return { index: sqliteVectorIndex(db), settle: async () => {} };
});
