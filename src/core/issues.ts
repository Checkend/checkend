import * as v from "valibot";
import { type Db, sql } from "../ports/db.ts";

/**
 * Read API (v1). Route schemas are Valibot, so that the OpenAPI document can be generated
 * from them later. Responses never include the raw payload.
 */
export const ISSUE_STATUSES = ["unresolved", "resolved", "ignored"] as const;

const id = v.pipe(v.string(), v.regex(/^\d{1,15}$/), v.transform(Number));

export const IdParam = v.object({ id });

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

export async function listIssues(
	db: Db,
	query: IssueListQuery,
	after: [string, number] | null,
): Promise<{ data: IssueRow[]; next_cursor: string | null }> {
	const [lastSeen, lastId] = after ?? ["9999", Number.MAX_SAFE_INTEGER];
	const rows = await db.all<IssueRow>({
		sql: `SELECT i.id, p.public_id AS project_id, i.title, i.culprit, i.type, i.level, i.platform,
				i.status, i.times_seen, i.stored_events, i.first_seen, i.last_seen, i.first_release,
				i.last_release, i.fingerprint, i.fingerprint_version
			FROM issues i JOIN projects p ON p.id = i.project_id
			WHERE (? IS NULL OR p.public_id = ? OR p.slug = ?) AND (? IS NULL OR i.status = ?)
				AND (i.last_seen < ? OR (i.last_seen = ? AND i.id < ?))
			ORDER BY i.last_seen DESC, i.id DESC LIMIT ?`,
		params: [
			query.project ?? null,
			query.project && /^\d{10}$/.test(query.project) ? Number(query.project) : null,
			query.project ?? null,
			query.status ?? null,
			query.status ?? null,
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
				i.last_release, i.fingerprint, i.fingerprint_version
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
