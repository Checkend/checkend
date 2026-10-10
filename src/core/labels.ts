import * as v from "valibot";
import { type Db, sql } from "../ports/db.ts";
import { parseSince, SINCE_PATTERN } from "./issues.ts";

/**
 * Triage labels: the decisions on issues (resolved, ignored, unresolved, regressed, merged,
 * split) and their corrections, from the triage_labels view over the activity timeline.
 */
export const LabelQuery = v.object({
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,4}$/), v.transform(Number), v.minValue(1), v.maxValue(1000)),
		"100",
	),
	since: v.optional(v.pipe(v.string(), v.regex(SINCE_PATTERN))),
});

export async function listLabels(
	db: Db,
	query: v.InferOutput<typeof LabelQuery>,
	now: Date,
): Promise<Record<string, unknown>[]> {
	const since = query.since ? parseSince(query.since, now) : null;
	const rows = await db.all(
		sql`SELECT id, at, issue_id, label, actor_type, actor_name, data, corrects FROM triage_labels
			WHERE (${since} IS NULL OR at >= ${since}) ORDER BY id DESC LIMIT ${query.limit}`,
	);
	return rows.map((row) => ({
		...row,
		data: row.data === null ? null : JSON.parse(String(row.data)),
	}));
}
