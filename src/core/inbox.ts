import { type Db, sql } from "../ports/db.ts";
import { decodeCursor, type ISSUE_STATUSES, type IssueRow, listIssues } from "./issues.ts";

/**
 * Reads for the web UI inbox. Same rules as the API: the project ID is the public ID, and
 * the raw payload is never read.
 */
export interface InboxQuery {
	/** Public project ID or slug. */
	project?: string | undefined;
	status?: (typeof ISSUE_STATUSES)[number] | undefined;
	environment?: string | undefined;
	release?: string | undefined;
	/** Last seen within a duration (24h, 7d) or after an ISO time. */
	since?: string | undefined;
	/** Text in the title or the culprit. */
	q?: string | undefined;
	limit: number;
	cursor?: string | undefined;
}

export interface InboxPage {
	data: IssueRow[];
	next_cursor: string | null;
}

/** The API issue list (same filters and cursor), with the project name of each issue. */
export async function listInbox(
	db: Db,
	query: InboxQuery,
	now: Date,
): Promise<InboxPage | "project_not_found"> {
	const after = query.cursor ? decodeCursor(query.cursor) : null;
	const page = await listIssues(
		db,
		{
			project: query.project,
			status: query.status,
			environment: query.environment,
			release: query.release,
			since: query.since,
			search: query.q,
			limit: query.limit,
		},
		after,
		now,
	);
	if (page === "project_not_found") return page;
	const projects = await db.all<{ id: number; name: string }>(
		sql`SELECT public_id AS id, name FROM projects WHERE deleted_at IS NULL`,
	);
	const names = new Map(projects.map((p) => [p.id, p.name]));
	return {
		...page,
		data: page.data.map((issue) => ({
			...issue,
			project_name: names.get(Number(issue.project_id)) ?? null,
		})),
	};
}

export interface InboxFacets {
	projects: { id: number; name: string; slug: string }[];
	environments: string[];
	releases: string[];
}

/** Values for the inbox filters. Environments and releases come from recent events only. */
export async function inboxFacets(db: Db): Promise<InboxFacets> {
	const [projects, environments, releases] = await Promise.all([
		db.all<{ id: number; name: string; slug: string }>(
			sql`SELECT public_id AS id, name, slug FROM projects WHERE deleted_at IS NULL ORDER BY name, id`,
		),
		db.all<{ value: string }>(
			sql`SELECT DISTINCT environment AS value FROM
				(SELECT environment FROM events ORDER BY id DESC LIMIT ${2000})
				WHERE environment IS NOT NULL ORDER BY value LIMIT ${50}`,
		),
		db.all<{ value: string }>(
			sql`SELECT DISTINCT release AS value FROM
				(SELECT release FROM events ORDER BY id DESC LIMIT ${2000})
				WHERE release IS NOT NULL ORDER BY value LIMIT ${50}`,
		),
	]);
	return {
		projects,
		environments: environments.map((r) => r.value),
		releases: releases.map((r) => r.value),
	};
}

export interface TagCount {
	key: string;
	value: string;
	count: number;
}

/** Tag values over the stored events of an issue, with the environment and the release. */
export async function issueTags(db: Db, issueId: number): Promise<TagCount[]> {
	return db.all<TagCount & Record<string, string | number>>(
		sql`SELECT key, value, count FROM (
				SELECT json_extract(t.value, '$[0]') AS key, json_extract(t.value, '$[1]') AS value,
					COUNT(*) AS count
				FROM events e, json_each(e.data, '$.tags') t WHERE e.issue_id = ${issueId}
				GROUP BY 1, 2
				UNION ALL
				SELECT 'environment', environment, COUNT(*) FROM events
				WHERE issue_id = ${issueId} AND environment IS NOT NULL GROUP BY environment
				UNION ALL
				SELECT 'release', release, COUNT(*) FROM events
				WHERE issue_id = ${issueId} AND release IS NOT NULL GROUP BY release
			) ORDER BY key, count DESC, value LIMIT ${200}`,
	);
}
