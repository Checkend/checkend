// CheckendBench v0: the stock Clef triage against labelled errors.
//
//   Run a dataset (JSONL, see dataset.ts) through Clef on Workers AI, via AI Gateway:
//     CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... [AI_GATEWAY_ID=...] \
//       node bench/checkendbench/run.ts --dataset cases.jsonl [--model clef-flash|clef]
//   Score the dogfood labels of an instance (no model call): save GET /v1/labels?limit=1000, then
//     node bench/checkendbench/run.ts --labels labels.json
//
// Each model call costs money on the Cloudflare account. The report goes to stdout as JSON.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { restModelRunner } from "../../src/adapters/node/model-runner.ts";
import { type ClefModel, clefDecisions } from "../../src/core/ai/decisions.ts";
import { TRIAGE_QUESTIONS, TRIAGE_VERSION } from "../../src/core/ai/triage.ts";
import { fetchClient } from "../../src/ports/http.ts";
import type { ModelRunner } from "../../src/ports/model-runner.ts";
import { type BenchCase, caseInput, pairsFromLabels, parseDataset } from "./dataset.ts";
import { type Prediction, predictionFromAnswers, type Report, score } from "./score.ts";

export interface BenchReport {
	benchmark: "CheckendBench v0";
	model: string;
	question_set: number;
	cases: number;
	/** Cases whose model call failed (not scored). */
	failed: number;
	input_tokens: number;
	scores: Report;
}

export async function runBench(
	models: ModelRunner,
	cases: BenchCase[],
	model: ClefModel,
): Promise<BenchReport> {
	let inputTokens = 0;
	// Counts the tokens of each call (the usage of the Clef output).
	const counting: ModelRunner = {
		async run(name, input) {
			const output = await models.run(name, input);
			const usage = (output as { usage?: { input_tokens?: unknown } } | null)?.usage;
			if (typeof usage?.input_tokens === "number") inputTokens += usage.input_tokens;
			return output;
		},
	};
	const provider = clefDecisions(counting, model);
	const pairs: { labels: BenchCase["labels"]; prediction: Prediction }[] = [];
	let failed = 0;
	for (const c of cases) {
		try {
			const answers = await provider.decide(caseInput(c), TRIAGE_QUESTIONS);
			pairs.push({ labels: c.labels, prediction: predictionFromAnswers(answers) });
		} catch {
			failed++;
		}
	}
	return {
		benchmark: "CheckendBench v0",
		model,
		question_set: TRIAGE_VERSION,
		cases: cases.length,
		failed,
		input_tokens: inputTokens,
		scores: score(pairs),
	};
}

async function main(args: string[]) {
	const value = (flag: string) => {
		const i = args.indexOf(flag);
		return i >= 0 ? args[i + 1] : undefined;
	};
	const labels = value("--labels");
	if (labels) {
		const body = JSON.parse(readFileSync(labels, "utf8")) as {
			data?: { label: string; data: unknown }[];
		};
		const pairs = pairsFromLabels(body.data ?? []);
		console.log(
			JSON.stringify(
				{
					benchmark: "CheckendBench v0 (dogfood labels)",
					pairs: pairs.length,
					scores: score(pairs),
				},
				null,
				2,
			),
		);
		return;
	}
	const dataset = value("--dataset");
	const model = (value("--model") ?? "clef-flash") as ClefModel;
	const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_API_TOKEN: apiToken } = process.env;
	if (!dataset || !accountId || !apiToken || (model !== "clef" && model !== "clef-flash")) {
		console.error("Usage: see the top of bench/checkendbench/run.ts");
		process.exit(2);
	}
	const runner = restModelRunner({
		accountId,
		apiToken,
		gateway: { id: process.env.AI_GATEWAY_ID ?? "default", collectLog: false },
		http: fetchClient,
	});
	const report = await runBench(runner, parseDataset(readFileSync(dataset, "utf8")), model);
	console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main(process.argv.slice(2));
}
