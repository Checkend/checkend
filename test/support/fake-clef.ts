import type { Question } from "../../src/core/ai/decisions.ts";
import type { ModelRunner } from "../../src/ports/model-runner.ts";

type Call = {
	model: string;
	input: { model: string; state: unknown; questions: Record<string, Question> };
};

/** A fake Clef: answers every question; `confidence` sets the confidence of choice answers. */
export function fakeClef(
	options: { confidence?: number; noise?: number; override?: (q: string) => unknown } = {},
) {
	const calls: Call[] = [];
	const runner: ModelRunner = {
		async run(model, input) {
			const call = { model, input } as unknown as Call;
			calls.push(call);
			const answers: Record<string, unknown> = {};
			for (const [id, q] of Object.entries(call.input.questions)) {
				const custom = options.override?.(id);
				if (custom !== undefined) answers[id] = custom;
				else if (q.type === "noul")
					answers[id] = { type: "noul", noul: id === "noise" ? (options.noise ?? 0.1) : 0.7 };
				else if (q.type === "choice") {
					const keys = Object.keys(q.criteria);
					const confidence = options.confidence ?? 0.9;
					answers[id] = {
						type: "choice",
						choice: keys[0],
						probabilities: Object.fromEntries(
							keys.map((k, i) => [k, i === 0 ? confidence : (1 - confidence) / (keys.length - 1)]),
						),
						confidence,
					};
				} else {
					answers[id] = {
						type: "score",
						score: 2.2,
						legend: Object.fromEntries(q.criteria.map((c, i) => [String(i), c])),
						probabilities: Object.fromEntries(
							q.criteria.map((_, i) => [String(i), i === 2 ? 0.8 : 0.2 / (q.criteria.length - 1)]),
						),
						confidence: 0.8,
					};
				}
			}
			return { model: call.input.model, answers, usage: { input_tokens: 400, output_tokens: 0 } };
		},
	};
	return { runner, calls };
}
