import { type Db, sql } from "../ports/db.ts";
import { decodeCursor, encodeCursor, type ISSUE_STATUSES, type IssueRow } from "./issues.ts";

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
	/** Text in the title or the culprit. */
	q?: string | undefined;
	limit: number;
	cursor?: string | undefined;
}

export interface InboxPage {
	data: IssueRow[];
	next_cursor: string | null;
}

const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export async function listInbox(db: Db, query: InboxQuery): Promise<InboxPage> {
	const [lastSeen, lastId] = (query.cursor ? decodeCursor(query.cursor) : null) ?? [
		"9999",
		Number.MAX_SAFE_INTEGER,
	];
	const project = query.project ?? null;
	const environment = query.environment ?? null;
	const release = query.release ?? null;
	const q = query.q ? likePattern(query.q) : null;
	const rows = await db.all<IssueRow>({
		sql: `SELECT i.id, p.public_id AS project_id, p.name AS project_name, p.slug AS project_slug,
				i.title, i.culprit, i.type, i.level, i.status, i.times_seen, i.first_seen, i.last_seen,
				i.first_release, i.last_release
			FROM issues i JOIN projects p ON p.id = i.project_id
			WHERE (? IS NULL OR p.public_id = ? OR p.slug = ?)
				AND (? IS NULL OR i.status = ?)
				AND (? IS NULL OR EXISTS (SELECT 1 FROM events e WHERE e.issue_id = i.id AND e.environment = ?))
				AND (? IS NULL OR i.first_release = ? OR i.last_release = ?
					OR EXISTS (SELECT 1 FROM events e WHERE e.issue_id = i.id AND e.release = ?))
				AND (? IS NULL OR i.title LIKE ? ESCAPE '\\' OR i.culprit LIKE ? ESCAPE '\\')
				AND (i.last_seen < ? OR (i.last_seen = ? AND i.id < ?))
			ORDER BY i.last_seen DESC, i.id DESC LIMIT ?`,
		params: [
			project,
			project && /^\d{10}$/.test(project) ? Number(project) : null,
			project,
			query.status ?? null,
			query.status ?? null,
			environment,
			environment,
			release,
			release,
			release,
			release,
			q,
			q,
			q,
			lastSeen,
			lastSeen,
			lastId,
			query.limit + 1,
		],
	});
	const page = rows.slice(0, query.limit);
	const last = page.at(-1);
	return {
		data: page,
		next_cursor:
			rows.length > query.limit && last
				? encodeCursor(String(last.last_seen), Number(last.id))
				: null,
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
			sql`SELECT public_id AS id, name, slug FROM projects ORDER BY name, id`,
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
