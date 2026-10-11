import * as v from "valibot";
import { buildModelInput, type ModelInput } from "../../src/core/ai/model-input.ts";
import type { NormalizedEvent } from "../../src/core/ingest/normalize.ts";
import type { Labels, Prediction } from "./score.ts";

/**
 * CheckendBench v0 case format (one JSON object per line). The error goes through
 * buildModelInput, so the benchmark input is scrubbed and normalized like the product input.
 * Every case names its source and license: only data that may be used (see the README).
 */
const Frame = v.object({
	function: v.optional(v.nullable(v.string())),
	filename: v.optional(v.nullable(v.string())),
	module: v.optional(v.nullable(v.string())),
	lineno: v.optional(v.nullable(v.number())),
	in_app: v.optional(v.nullable(v.boolean())),
	context_line: v.optional(v.nullable(v.string())),
});

export const BenchCase = v.strictObject({
	id: v.pipe(v.string(), v.minLength(1)),
	source: v.pipe(v.string(), v.minLength(1)),
	license: v.pipe(v.string(), v.minLength(1)),
	error: v.object({
		title: v.string(),
		level: v.optional(v.string(), "error"),
		platform: v.optional(v.nullable(v.string())),
		environment: v.optional(v.nullable(v.string())),
		message: v.optional(v.nullable(v.string())),
		exceptions: v.optional(
			v.array(
				v.object({
					type: v.nullable(v.string()),
					value: v.string(),
					frames: v.optional(v.array(Frame), []),
				}),
			),
			[],
		),
	}),
	labels: v.object({
		category: v.optional(v.string()),
		severity: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(3))),
		transient: v.optional(v.boolean()),
		agent_fixable: v.optional(v.boolean()),
		noise: v.optional(v.boolean()),
	}),
});
export type BenchCase = v.InferOutput<typeof BenchCase>;

/** Parses JSONL. Throws with the line number on the first bad case. */
export function parseDataset(text: string): BenchCase[] {
	return text
		.split("\n")
		.map((line, i) => ({ line: line.trim(), number: i + 1 }))
		.filter(({ line }) => line.length > 0)
		.map(({ line, number }) => {
			const parsed = v.safeParse(BenchCase, JSON.parse(line));
			if (!parsed.success) {
				throw new Error(
					`Line ${number}: ${v.getDotPath(parsed.issues[0]) ?? ""} ${parsed.issues[0].message}`,
				);
			}
			return parsed.output;
		});
}

/** The model input of a case, made the same way as for a stored issue. */
export function caseInput(c: BenchCase): ModelInput {
	const event = {
		platform: c.error.platform ?? null,
		environment: c.error.environment ?? null,
		message: c.error.message ?? null,
		exceptions: c.error.exceptions.map((e) => ({
			type: e.type,
			value: e.value,
			module: null,
			mechanism: null,
			frames: e.frames.map((f) => ({
				filename: f.filename ?? null,
				abs_path: null,
				module: f.module ?? null,
				function: f.function ?? null,
				lineno: f.lineno ?? null,
				colno: null,
				in_app: f.in_app ?? null,
				context_line: f.context_line ?? null,
				pre_context: [],
				post_context: [],
			})),
		})),
	} as unknown as NormalizedEvent;
	return buildModelInput({ title: c.error.title, level: c.error.level }, event, null);
}

/**
 * The dogfood labels: rows of GET /v1/labels with label "triage_corrected". Each has the
 * correction and the model answer of that time, so it is scored without a model call.
 */
export function pairsFromLabels(
	rows: { label: string; data: unknown }[],
): { labels: Labels; prediction: Prediction }[] {
	return rows.flatMap((row) => {
		if (row.label !== "triage_corrected") return [];
		const data = row.data as { corrected?: Labels; model_answer?: Prediction | null } | null;
		if (!data?.corrected || !data.model_answer) return [];
		return [{ labels: data.corrected, prediction: data.model_answer }];
	});
}
