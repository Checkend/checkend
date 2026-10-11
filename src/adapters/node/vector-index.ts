import { type Db, sql } from "../../ports/db.ts";
import type { VectorIndex, VectorMatch } from "../../ports/vector-index.ts";

const encode = (values: number[]) => new Uint8Array(new Float32Array(values).buffer);
const decode = (bytes: Uint8Array) =>
	new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));

function cosine(a: Float32Array | number[], b: Float32Array): number {
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < b.length; i++) {
		const x = a[i] ?? 0;
		const y = b[i] ?? 0;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * VectorIndex in SQLite (the vectors table): an exact search over all vectors. Good for the
 * size of one self-hosted install (tens of thousands of issues); not for Workers (CPU limit).
 */
export function sqliteVectorIndex(db: Db): VectorIndex {
	const search = async (target: Float32Array | number[], topK: number): Promise<VectorMatch[]> => {
		const rows = await db.all<{ id: string; vector: Uint8Array }>(
			sql`SELECT id, vector FROM vectors`,
		);
		return rows
			.map((row) => ({ id: row.id, score: cosine(target, decode(row.vector)) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK);
	};
	return {
		async upsert(items) {
			if (items.length === 0) return;
			await db.batch(
				items.map(
					(item) =>
						sql`INSERT INTO vectors (id, vector) VALUES (${item.id}, ${encode(item.values)})
							ON CONFLICT (id) DO UPDATE SET vector = excluded.vector`,
				),
			);
		},
		query: (values, topK) => search(values, topK),
		async queryById(id, topK) {
			const row = await db.first<{ vector: Uint8Array }>(
				sql`SELECT vector FROM vectors WHERE id = ${id}`,
			);
			return row ? search(decode(row.vector), topK) : [];
		},
		async deleteByIds(ids) {
			if (ids.length === 0) return;
			await db.batch(ids.map((id) => sql`DELETE FROM vectors WHERE id = ${id}`));
		},
	};
}
