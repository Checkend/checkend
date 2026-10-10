import { type Db, sql } from "../ports/db.ts";

/**
 * Tag values that are much more common in an issue than in its project: for example
 * browser=Safari in 90% of the issue's events, but in 12% of the project's recent events. The
 * values come from the application (untrusted). The database counts them (json_each), so the
 * Worker does little work.
 */
export interface UnusualTag {
	key: string;
	value: string;
	/** Share of the issue's stored events with this value (0 to 1). */
	issue_share: number;
	/** Share of the project's recent stored events (other issues) with this value. */
	project_share: number;
}

/** Stored events of the project that are the baseline. */
const BASELINE_EVENTS = 1000;
const MIN_ISSUE_EVENTS = 3;
const MIN_BASELINE_EVENTS = 20;
const MIN_ISSUE_SHARE = 0.5;
const MIN_RATIO = 2;
const MAX_RESULTS = 5;

export async function unusualTags(db: Db, issueId: number): Promise<UnusualTag[]> {
	const issue = await db.first<{ project_id: number; n: number }>(
		sql`SELECT i.project_id, (SELECT count(*) FROM events WHERE issue_id = i.id) AS n
			FROM issues i WHERE i.id = ${issueId}`,
	);
	if (!issue || issue.n < MIN_ISSUE_EVENTS) return [];
	const baseline = await db.first<{ n: number }>(
		sql`SELECT count(*) AS n FROM (SELECT id FROM events WHERE project_id = ${issue.project_id}
			AND issue_id != ${issueId} ORDER BY id DESC LIMIT ${BASELINE_EVENTS})`,
	);
	const baselineEvents = baseline?.n ?? 0;
	if (baselineEvents < MIN_BASELINE_EVENTS) return [];
	const rows = await db.all<{
		key: string;
		value: string;
		issue_count: number;
		project_count: number;
	}>(
		sql`WITH issue_tags AS (
				SELECT json_extract(t.value, '$[0]') AS key, json_extract(t.value, '$[1]') AS value, count(*) AS n
				FROM events e, json_each(e.data, '$.tags') t
				WHERE e.issue_id = ${issueId} GROUP BY 1, 2
			),
			recent AS (
				SELECT data FROM events WHERE project_id = ${issue.project_id} AND issue_id != ${issueId}
				ORDER BY id DESC LIMIT ${BASELINE_EVENTS}
			),
			project_tags AS (
				SELECT json_extract(t.value, '$[0]') AS key, json_extract(t.value, '$[1]') AS value, count(*) AS n
				FROM recent e, json_each(e.data, '$.tags') t GROUP BY 1, 2
			)
			SELECT it.key, it.value, it.n AS issue_count, coalesce(pt.n, 0) AS project_count
			FROM issue_tags it LEFT JOIN project_tags pt ON pt.key = it.key AND pt.value = it.value
			WHERE it.n >= ${Math.ceil(issue.n * MIN_ISSUE_SHARE)}`,
	);
	return rows
		.map((r) => ({
			key: String(r.key),
			value: String(r.value),
			issue_share: r.issue_count / issue.n,
			project_share: r.project_count / baselineEvents,
		}))
		.filter((t) => t.issue_share >= MIN_RATIO * t.project_share && t.issue_share > t.project_share)
		.sort((a, b) => b.issue_share - b.project_share - (a.issue_share - a.project_share))
		.slice(0, MAX_RESULTS)
		.map((t) => ({
			...t,
			issue_share: Math.round(t.issue_share * 100) / 100,
			project_share: Math.round(t.project_share * 100) / 100,
		}));
}
