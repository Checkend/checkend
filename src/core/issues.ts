import * as v from "valibot";
import { type Db, sql } from "../ports/db.ts";

/**
 * Read API (v1). Route schemas are Valibot, so that the OpenAPI document can be generated
 * from them later. Responses never include the raw payload.
 */
export const ISSUE_STATUSES = ["unresolved", "resolved", "ignored", "merged"] as const;

const id = v.pipe(v.string(), v.regex(/^\d{1,15}$/), v.transform(Number));

export const IdParam = v.object({ id });

/** `since`: a duration (30m, 24h, 7d) or an ISO date/time. */
export const SINCE_PATTERN =
	/^(\d{1,4}[smhd]|\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?)$/;

/** A project: its public ID (10 digits) or its slug. Never the internal row ID. */
export const ProjectRef = v.pipe(v.string(), v.regex(/^[a-z0-9][a-z0-9-]{0,47}$/));

export const IssueListQuery = v.object({
	project: v.optional(ProjectRef),
	status: v.optional(v.picklist(ISSUE_STATUSES)),
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1), v.maxValue(100)),
		"25",
	),
	cursor: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,200}$/))),
	release: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
	environment: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
	since: v.optional(v.pipe(v.string(), v.regex(SINCE_PATTERN))),
	search: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
});
export type IssueListQuery = v.InferOutput<typeof IssueListQuery>;

export const EventListQuery = v.object({
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1), v.maxValue(100)),
		"25",
	),
});

export const CreateProjectBody = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	platform: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(32))),
});

export type IssueRow = Record<string, string | number | null>;

const encodeCursor = (lastSeen: string, issueId: number) =>
	btoa(JSON.stringify([lastSeen, issueId]))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export function decodeCursor(cursor: string): [string, number] | null {
	try {
		const value = JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/")));
		if (Array.isArray(value) && typeof value[0] === "string" && Number.isInteger(value[1])) {
			return [value[0], value[1]];
		}
	} catch {
		// invalid cursor
	}
	return null;
}

const UNIT_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

/** The ISO time for a `since` value, or null when it is not valid. */
export function parseSince(value: string, now: Date): string | null {
	if (!SINCE_PATTERN.test(value)) return null;
	const duration = /^(\d+)([smhd])$/.exec(value);
	const ms = duration
		? now.getTime() - Number(duration[1]) * UNIT_MS[duration[2] as keyof typeof UNIT_MS]
		: Date.parse(value);
	return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** LIKE pattern for a plain substring: user input cannot add wildcards. Use with ESCAPE '\'. */
export const likeContains = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** The internal row ID of a project, from its public ID or slug; null when there is none. */
export async function findProjectRowId(db: Db, ref: string): Promise<number | null> {
	const row = await db.first<{ id: number }>(
		sql`SELECT id FROM projects WHERE public_id = ${/^\d{10}$/.test(ref) ? Number(ref) : null} OR slug = ${ref}`,
	);
	return row?.id ?? null;
}

export type IssueFilters = Omit<IssueListQuery, "since"> & { since?: string | undefined };

/**
 * One page of issues, the most recently seen first. Returns "project_not_found" when the
 * project filter matches no project, so that a typo does not look like "no issues".
 */
export async function listIssues(
	db: Db,
	query: IssueFilters,
	after: [string, number] | null,
	now: Date,
): Promise<{ data: IssueRow[]; next_cursor: string | null } | "project_not_found"> {
	const [lastSeen, lastId] = after ?? ["9999", Number.MAX_SAFE_INTEGER];
	const projectRowId = query.project ? await findProjectRowId(db, query.project) : null;
	if (query.project && projectRowId === null) return "project_not_found";
	const since = query.since ? parseSince(query.since, now) : null;
	const search = query.search ? likeContains(query.search) : null;
	const release = query.release ?? null;
	const environment = query.environment ?? null;
	const rows = await db.all<IssueRow>({
		sql: `SELECT i.id, p.public_id AS project_id, i.title, i.culprit, i.type, i.level, i.platform,
				i.status, i.times_seen, i.stored_events, i.first_seen, i.last_seen, i.first_release,
				i.last_release, i.fingerprint, i.fingerprint_version
			FROM issues i JOIN projects p ON p.id = i.project_id
			WHERE (? IS NULL OR i.project_id = ?)
				AND (i.status = ? OR (? IS NULL AND i.status != 'merged'))
				AND (? IS NULL OR i.last_seen >= ?)
				AND (? IS NULL OR i.first_release = ? OR i.last_release = ?
					OR EXISTS (SELECT 1 FROM events e WHERE e.issue_id = i.id AND e.release = ?))
				AND (? IS NULL OR EXISTS (SELECT 1 FROM events e WHERE e.issue_id = i.id AND e.environment = ?))
				AND (? IS NULL OR i.title LIKE ? ESCAPE '\\' OR i.culprit LIKE ? ESCAPE '\\')
				AND (i.last_seen < ? OR (i.last_seen = ? AND i.id < ?))
			ORDER BY i.last_seen DESC, i.id DESC LIMIT ?`,
		params: [
			projectRowId,
			projectRowId,
			query.status ?? null,
			query.status ?? null,
			since,
			since,
			release,
			release,
			release,
			release,
			environment,
			environment,
			search,
			search,
			search,
			lastSeen,
			lastSeen,
			lastId,
			query.limit + 1,
		],
	});
	const page = rows.slice(0, query.limit);
	const last = page.at(-1);
	const next_cursor =
		rows.length > query.limit && last
			? encodeCursor(String(last.last_seen), Number(last.id))
			: null;
	return { data: page, next_cursor };
}

export async function getIssue(db: Db, issueId: number): Promise<IssueRow | null> {
	const issue = await db.first<IssueRow>({
		sql: `SELECT i.id, p.public_id AS project_id, i.title, i.culprit, i.type, i.level, i.platform,
				i.status, i.times_seen, i.stored_events, i.first_seen, i.last_seen, i.first_release,
				i.last_release, i.fingerprint, i.fingerprint_version, i.merged_into
			FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ?`,
		params: [issueId],
	});
	if (!issue) return null;
	const latest = await db.first<{ id: number }>(
		sql`SELECT id FROM events WHERE issue_id = ${issueId} ORDER BY id DESC LIMIT 1`,
	);
	return { ...issue, latest_event_id: latest?.id ?? null };
}

export async function listIssueEvents(db: Db, issueId: number, limit: number): Promise<IssueRow[]> {
	return db.all<IssueRow>({
		sql: `SELECT e.id, e.issue_id, p.public_id AS project_id, e.event_id, e.timestamp, e.received_at,
				e.level, e.release, e.environment
			FROM events e JOIN projects p ON p.id = e.project_id
			WHERE e.issue_id = ? ORDER BY e.id DESC LIMIT ?`,
		params: [issueId, limit],
	});
}

export async function getEvent(db: Db, eventId: number): Promise<Record<string, unknown> | null> {
	const row = await db.first<IssueRow & { data: string }>({
		sql: `SELECT e.id, e.issue_id, p.public_id AS project_id, e.event_id, e.timestamp, e.received_at,
				e.level, e.release, e.environment, e.data
			FROM events e JOIN projects p ON p.id = e.project_id WHERE e.id = ?`,
		params: [eventId],
	});
	if (!row) return null;
	const { data, ...summary } = row;
	return { ...summary, event: JSON.parse(data) };
}
