import type { Answer } from "../../src/core/ai/decisions.ts";

/** Labels of a case: the true answers (any subset). */
export interface Labels {
	category?: string | undefined;
	/** 0 (cosmetic) to 3 (critical). */
	severity?: number | undefined;
	transient?: boolean | undefined;
	agent_fixable?: boolean | undefined;
	noise?: boolean | undefined;
}

/** A model answer in the terms of the labels (from Clef answers, or from a stored label row). */
export interface Prediction {
	category?: string | undefined;
	severity?: number | undefined;
	transient?: number | undefined;
	agent_fixable?: number | undefined;
	noise?: number | undefined;
}

const NOULS = ["transient", "agent_fixable", "noise"] as const;

export function predictionFromAnswers(answers: Record<string, Answer>): Prediction {
	const out: Prediction = {};
	const category = answers.category;
	if (category?.type === "choice") out.category = category.choice;
	const severity = answers.severity;
	if (severity?.type === "score") out.severity = severity.score;
	for (const key of NOULS) {
		const answer = answers[key];
		if (answer?.type === "noul") out[key] = answer.noul;
	}
	return out;
}

export interface QuestionScore {
	n: number;
	correct: number;
	accuracy: number | null;
}

export interface Report {
	cases: number;
	category: QuestionScore & { confusion: Record<string, Record<string, number>> };
	severity: QuestionScore & { mean_abs_error: number | null };
	transient: QuestionScore & { brier: number | null };
	agent_fixable: QuestionScore & { brier: number | null };
	noise: QuestionScore & { brier: number | null };
}

const ratio = (a: number, n: number) => (n === 0 ? null : Math.round((a / n) * 1000) / 1000);

/** Scores predictions against labels. A question counts only where both exist. */
export function score(pairs: { labels: Labels; prediction: Prediction }[]): Report {
	const confusion: Record<string, Record<string, number>> = {};
	let catN = 0;
	let catOk = 0;
	let sevN = 0;
	let sevOk = 0;
	let sevErr = 0;
	const noul = Object.fromEntries(NOULS.map((k) => [k, { n: 0, ok: 0, brier: 0 }])) as Record<
		(typeof NOULS)[number],
		{ n: number; ok: number; brier: number }
	>;
	for (const { labels, prediction } of pairs) {
		if (labels.category !== undefined && prediction.category !== undefined) {
			catN++;
			if (labels.category === prediction.category) catOk++;
			const row = confusion[labels.category] ?? {};
			confusion[labels.category] = row;
			row[prediction.category] = (row[prediction.category] ?? 0) + 1;
		}
		if (labels.severity !== undefined && prediction.severity !== undefined) {
			sevN++;
			if (Math.round(prediction.severity) === labels.severity) sevOk++;
			sevErr += Math.abs(prediction.severity - labels.severity);
		}
		for (const key of NOULS) {
			const label = labels[key];
			const p = prediction[key];
			if (label === undefined || p === undefined) continue;
			const s = noul[key];
			s.n++;
			if (p >= 0.5 === label) s.ok++;
			s.brier += (p - (label ? 1 : 0)) ** 2;
		}
	}
	const nouls = Object.fromEntries(
		NOULS.map((k) => {
			const s = noul[k];
			return [k, { n: s.n, correct: s.ok, accuracy: ratio(s.ok, s.n), brier: ratio(s.brier, s.n) }];
		}),
	) as Pick<Report, (typeof NOULS)[number]>;
	return {
		cases: pairs.length,
		category: { n: catN, correct: catOk, accuracy: ratio(catOk, catN), confusion },
		severity: {
			n: sevN,
			correct: sevOk,
			accuracy: ratio(sevOk, sevN),
			mean_abs_error: ratio(sevErr, sevN),
		},
		...nouls,
	};
}
