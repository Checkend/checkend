import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import { cleanText } from "./ingest/normalize.ts";
import type { Claim } from "./issues.ts";
import { type Actor, hasScope } from "./tokens.ts";

/**
 * Claims (leases) and notes. A claim lets one agent work on an issue: a second agent gets a
 * conflict until the claim expires or the holder releases it. The holder is the actor (token
 * or the bootstrap admin token); the same actor can renew its claim.
 */
export const CLAIM_DEFAULT_MINUTES = 120;
export const CLAIM_MAX_MINUTES = 1440;
export const NOTE_MAX_CHARS = 4000;

type P = Pick<Ports, "db" | "clock">;

export type ClaimResult =
	| { kind: "done" }
	| { kind: "not_found" }
	| { kind: "claimed"; claim: Claim }
	| { kind: "not_holder"; claim: Claim };

export async function claimIssue(
	ports: P,
	actor: Actor,
	issueId: number,
	minutes = CLAIM_DEFAULT_MINUTES,
): Promise<ClaimResult> {
	const now = ports.clock.now();
	const nowIso = now.toISOString();
	const expires = new Date(now.getTime() + minutes * 60_000).toISOString();
	const holderId = actor.id ?? -1;
	// The claim is free when there is none, when it expired, or when this actor holds it (a
	// renewal). The activity row is written first, with the same condition.
	const [, update] = await ports.db.batch([
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${nowIso}, ${actor.type}, ${actor.id}, ${actor.name}, 'issue.claim', 'issue', id,
				${JSON.stringify({ minutes, expires_at: expires })}
			FROM issues WHERE id = ${issueId} AND status != 'merged'
				AND (claim_expires_at IS NULL OR claim_expires_at <= ${nowIso}
					OR (claimed_by_type = ${actor.type} AND coalesce(claimed_by_id, -1) = ${holderId}))`,
		sql`UPDATE issues SET claimed_by_type = ${actor.type}, claimed_by_id = ${actor.id}, claimed_by = ${actor.name},
				claim_expires_at = ${expires}
			WHERE id = ${issueId} AND status != 'merged'
				AND (claim_expires_at IS NULL OR claim_expires_at <= ${nowIso}
					OR (claimed_by_type = ${actor.type} AND coalesce(claimed_by_id, -1) = ${holderId}))`,
	]);
	if ((update?.changes ?? 0) > 0) return { kind: "done" };
	const current = await ports.db.first<{
		claimed_by: string | null;
		claim_expires_at: string | null;
		status: string;
	}>(sql`SELECT claimed_by, claim_expires_at, status FROM issues WHERE id = ${issueId}`);
	if (!current || current.status === "merged") return { kind: "not_found" };
	return {
		kind: "claimed",
		claim: { holder: current.claimed_by ?? "", expires_at: current.claim_expires_at ?? "" },
	};
}

/** True when the actor holds an active claim on the issue. */
export async function holdsClaim(ports: P, actor: Actor, issueId: number): Promise<boolean> {
	const row = await ports.db.first<{ id: number }>(
		sql`SELECT id FROM issues WHERE id = ${issueId} AND claim_expires_at > ${ports.clock.now().toISOString()}
			AND claimed_by_type = ${actor.type} AND coalesce(claimed_by_id, -1) = ${actor.id ?? -1}`,
	);
	return row !== null;
}

/** Releases a claim. Only the holder or an admin can release an active claim. */
export async function releaseClaim(ports: P, actor: Actor, issueId: number): Promise<ClaimResult> {
	const now = ports.clock.now();
	const nowIso = now.toISOString();
	const issue = await ports.db.first<{
		claim_expires_at: string | null;
		claimed_by_type: string | null;
		claimed_by_id: number | null;
		claimed_by: string | null;
	}>(
		sql`SELECT claim_expires_at, claimed_by_type, claimed_by_id, claimed_by FROM issues WHERE id = ${issueId} AND status != 'merged'`,
	);
	if (!issue) return { kind: "not_found" };
	const active = issue.claim_expires_at !== null && issue.claim_expires_at > nowIso;
	if (!active) return { kind: "done" };
	const isHolder =
		issue.claimed_by_type === actor.type && (issue.claimed_by_id ?? -1) === (actor.id ?? -1);
	if (!isHolder && !hasScope(actor, "admin")) {
		return {
			kind: "not_holder",
			claim: { holder: issue.claimed_by ?? "", expires_at: issue.claim_expires_at ?? "" },
		};
	}
	await ports.db.batch([
		activityStatement(actor, "issue.release", { type: "issue", id: issueId }, undefined, now),
		sql`UPDATE issues SET claimed_by_type = NULL, claimed_by_id = NULL, claimed_by = NULL, claim_expires_at = NULL
			WHERE id = ${issueId}`,
	]);
	return { kind: "done" };
}

/** Adds a note to the timeline of an issue. The text is cleaned like event text. */
export async function addNote(
	ports: P,
	actor: Actor,
	issueId: number,
	text: string,
): Promise<number | null> {
	const exists = await ports.db.first(sql`SELECT id FROM issues WHERE id = ${issueId}`);
	if (!exists) return null;
	const data = JSON.stringify({ text: cleanText(text, NOTE_MAX_CHARS) });
	const [inserted] = await ports.db.batch([
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			VALUES (${ports.clock.now().toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, 'issue.note', 'issue',
				${issueId}, ${data})
			RETURNING id`,
	]);
	return Number(inserted?.rows[0]?.id);
}

export type TimelineRow = Record<string, unknown>;

/** The timeline of one issue: its activity rows, the most recent first. */
export async function issueTimeline(
	ports: Pick<Ports, "db">,
	issueId: number,
	limit: number,
): Promise<TimelineRow[]> {
	const rows = await ports.db.all(
		sql`SELECT id, at, actor_type, actor_name, action, data FROM activity
			WHERE target_type = 'issue' AND target_id = ${issueId} ORDER BY id DESC LIMIT ${limit}`,
	);
	return rows.map((row) => ({
		...row,
		data: row.data === null ? null : JSON.parse(String(row.data)),
	}));
}
