import type { ModelRunner } from "../../src/ports/model-runner.ts";

const words = (text: string) => text.toLowerCase().match(/[a-z]{3,}/g) ?? [];

/** A word-count vector in 1024 buckets: texts with the same words get close vectors. */
export function fakeVector(text: string): number[] {
	const v: number[] = Array.from({ length: 1024 }, () => 0);
	for (const word of words(text)) {
		let h = 0;
		for (const c of word) h = (h * 31 + c.charCodeAt(0)) % 1024;
		v[h] = (v[h] ?? 0) + 1;
	}
	if (!v.some((x) => x !== 0)) v[0] = 1;
	return v;
}

/** Fake Workers AI for the embedding model and the reranker; records the calls. */
export function fakeEmbeddings(options: { dims?: number } = {}) {
	const calls: { model: string; input: Record<string, unknown> }[] = [];
	const runner: ModelRunner = {
		async run(model, input) {
			calls.push({ model, input });
			if (model === "@cf/qwen/qwen3-embedding-0.6b") {
				const texts = input.text as string[];
				const data = texts.map((t) => fakeVector(t).slice(0, options.dims ?? 1024));
				return { data, shape: [data.length, options.dims ?? 1024] };
			}
			if (model === "@cf/baai/bge-reranker-base") {
				const query = new Set(words(String(input.query)));
				const contexts = input.contexts as { text: string }[];
				return {
					response: contexts.map((c, id) => ({
						id,
						score: words(c.text).filter((w) => query.has(w)).length / Math.max(1, query.size),
					})),
				};
			}
			throw new Error(`unexpected model ${model}`);
		},
	};
	return { runner, calls };
}
