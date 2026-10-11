import * as v from "valibot";
import type { ModelRunner } from "../../ports/model-runner.ts";
import type { ModelInput } from "./model-input.ts";

/** A typed question (the System One API of Clef). */
export type Question =
	| { type: "noul"; instructions: string }
	| { type: "choice"; instructions: string; criteria: Record<string, string> }
	| { type: "score"; instructions: string; criteria: string[] };

export type Answer =
	| { type: "noul"; noul: number }
	| { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
	| { type: "score"; score: number; probabilities: Record<string, number>; confidence: number };

/**
 * Answers typed questions about an error with probabilities. The stock provider runs Clef on the
 * install's own Workers AI; another provider (a tuned model) can take its place later.
 */
export interface DecisionProvider {
	/** The model name that is stored with the answers. */
	readonly model: string;
	decide(input: ModelInput, questions: Record<string, Question>): Promise<Record<string, Answer>>;
}

const Probability = v.pipe(v.number(), v.minValue(0), v.maxValue(1));
const Probabilities = v.record(v.string(), Probability);

/** Checks one answer against its question: the type, the options, the ranges. */
function checkAnswer(id: string, question: Question, raw: unknown): Answer {
	const fail = (): never => {
		throw new Error(`Clef answer "${id}" does not match the question.`);
	};
	if (question.type === "noul") {
		const out = v.safeParse(v.object({ type: v.literal("noul"), noul: Probability }), raw);
		return out.success ? { type: "noul", noul: out.output.noul } : fail();
	}
	const levels =
		question.type === "choice"
			? Object.keys(question.criteria)
			: question.criteria.map((_, i) => String(i));
	const shape = v.object({
		type: v.literal(question.type),
		probabilities: Probabilities,
		confidence: Probability,
		...(question.type === "choice"
			? { choice: v.picklist(levels as [string, ...string[]]) }
			: { score: v.pipe(v.number(), v.minValue(0), v.maxValue(levels.length - 1)) }),
	});
	const out = v.safeParse(shape, raw);
	if (!out.success) return fail();
	// Only the options of the question, so stored answers never hold other keys.
	const probabilities = Object.fromEntries(
		levels.map((l) => [l, out.output.probabilities[l] ?? 0]),
	);
	const { confidence } = out.output;
	return question.type === "choice"
		? {
				type: "choice",
				choice: (out.output as { choice: string }).choice,
				probabilities,
				confidence,
			}
		: { type: "score", score: (out.output as { score: number }).score, probabilities, confidence };
}

export type ClefModel = "clef" | "clef-flash";

/** The stock DecisionProvider: Clef or Clef-flash on Workers AI (through AI Gateway). */
export function clefDecisions(
	models: ModelRunner,
	model: ClefModel = "clef-flash",
): DecisionProvider {
	return {
		model,
		async decide(input, questions) {
			const output = (await models.run(`@cf/cloudflare/${model}`, {
				model,
				state: input.state,
				questions,
			})) as { answers?: Record<string, unknown> } | null;
			const answers: Record<string, Answer> = {};
			for (const [id, question] of Object.entries(questions)) {
				answers[id] = checkAnswer(id, question, output?.answers?.[id]);
			}
			return answers;
		},
	};
}
