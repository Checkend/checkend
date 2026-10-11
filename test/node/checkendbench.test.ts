import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caseInput, pairsFromLabels, parseDataset } from "../../bench/checkendbench/dataset.ts";
import { runBench } from "../../bench/checkendbench/run.ts";
import { score } from "../../bench/checkendbench/score.ts";
import { fakeClef } from "../support/fake-clef.ts";

const sample = readFileSync("test/fixtures/checkendbench/sample.jsonl", "utf8");

describe("CheckendBench v0", () => {
	it("parses the dataset format, and names the bad line", () => {
		expect(parseDataset(sample).map((c) => c.id)).toEqual([
			"synthetic-1",
			"synthetic-2",
			"synthetic-3",
		]);
		expect(() =>
			parseDataset(
				`${sample}\n{"id":"x","source":"s","license":"l","error":{"title":"t"},"labels":{"severity":9}}`,
			),
		).toThrow(/Line 5/);
	});

	it("makes the input like the product: scrubbed and normalized", () => {
		const input = caseInput(parseDataset(sample)[1] as never);
		expect(JSON.stringify(input.state)).toContain("<ip>");
		expect(JSON.stringify(input.state)).not.toContain("10.0.0.5");
	});

	it("scores accuracy per question, a confusion table, severity error and Brier scores", () => {
		const report = score([
			{
				labels: { category: "code_bug", severity: 2, noise: false },
				prediction: { category: "code_bug", severity: 2.2, noise: 0.1 },
			},
			{
				labels: { category: "infrastructure", noise: true },
				prediction: { category: "code_bug", noise: 0.4 },
			},
		]);
		expect(report.category).toEqual({
			n: 2,
			correct: 1,
			accuracy: 0.5,
			confusion: { code_bug: { code_bug: 1 }, infrastructure: { code_bug: 1 } },
		});
		expect(report.severity).toEqual({ n: 1, correct: 1, accuracy: 1, mean_abs_error: 0.2 });
		expect(report.noise).toEqual({ n: 2, correct: 1, accuracy: 0.5, brier: 0.185 });
		expect(report.transient.accuracy).toBeNull();
	});

	it("scores the dogfood labels without a model call", () => {
		const pairs = pairsFromLabels([
			{
				label: "triage_corrected",
				data: { corrected: { category: "infrastructure" }, model_answer: { category: "code_bug" } },
			},
			{ label: "triage_corrected", data: { corrected: { severity: 1 }, model_answer: null } },
			{ label: "resolved", data: null },
		]);
		expect(score(pairs).category).toMatchObject({ n: 1, correct: 0 });
	});

	it("runs stock Clef on a dataset and reports the model, the scores and the tokens", async () => {
		const clef = fakeClef();
		const report = await runBench(clef.runner, parseDataset(sample), "clef-flash");
		expect(clef.calls).toHaveLength(3);
		expect(report).toMatchObject({
			benchmark: "CheckendBench v0",
			model: "clef-flash",
			cases: 3,
			failed: 0,
			input_tokens: 1200,
			scores: { category: { n: 2, correct: 1 } },
		});
	});
});
