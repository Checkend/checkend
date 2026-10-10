import { type Statement, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import { issueTitle } from "./ingest/fingerprint.ts";
import type { NormalizedEvent } from "./ingest/normalize.ts";
import type { Actor } from "./tokens.ts";

/**
 * Issue actions by agents and people: status changes and merges. Each action and its activity
 * row are one atomic batch. Actions listed in config.requireApproval (ignore, merge) create a
 * pending approval instead; an admin approves or rejects it.
 */
export type IssueStatus = "unresolved" | "resolved" | "ignored";
export type ActionResult =
	| { kind: "done" }
	| { kind: "approval_required"; approvalId: number }
	| { kind: "not_found" }
	| { kind: "invalid"; message: string };

type P = Pick<Ports, "db" | "clock" | "config">;

const ACTION_OF: Record<IssueStatus, string> = {
	resolved: "resolve",
	ignored: "ignore",
	unresolved: "unresolve",
};
const APPROVAL_DAYS = 7;

async function issueRow(ports: P, issueId: number) {
	return ports.db.first<{
		id: number;
		project_id: number;
		status: string;
		merged_into: number | null;
	}>(sql`SELECT id, project_id, status, merged_into FROM issues WHERE id = ${issueId}`);
}

/** Sets the status of an issue (not of a merged issue). */
export async function setIssueStatus(
	ports: P,
	actor: Actor,
	issueId: number,
	status: IssueStatus,
	options: { skipApproval?: boolean } = {},
): Promise<ActionResult> {
	const issue = await issueRow(ports, issueId);
	if (!issue || issue.status === "merged") return { kind: "not_found" };
	const action = ACTION_OF[status];
	if (!options.skipApproval && ports.config.requireApproval.includes(action)) {
		return requestApproval(ports, actor, action, issueId, { status });
	}
	const now = ports.clock.now();
	await ports.db.batch([
		activityStatement(
			actor,
			`issue.${action}`,
			{ type: "issue", id: issueId },
			{ from: issue.status, to: status },
			now,
		),
		sql`UPDATE issues SET status = ${status}, status_changed_at = ${now.toISOString()} WHERE id = ${issueId}`,
	]);
	return { kind: "done" };
}

export const MAX_MERGE_SOURCES = 10;

/**
 * Merges source issues into the target: events and counts move to the target; each source
 * gets status 'merged' and merged_into = target. Later events with a source fingerprint go to
 * the target (ingest follows merged_into).
 */
export async function mergeIssues(
	ports: P,
	actor: Actor,
	targetId: number,
	sourceIds: number[],
	options: { skipApproval?: boolean } = {},
): Promise<ActionResult> {
	const sources = [...new Set(sourceIds)];
	if (sources.length === 0 || sources.length > MAX_MERGE_SOURCES) {
		return { kind: "invalid", message: `Give 1 to ${MAX_MERGE_SOURCES} source issues.` };
	}
	if (sources.includes(targetId))
		return { kind: "invalid", message: "An issue cannot be merged into itself." };
	const target = await issueRow(ports, targetId);
	if (!target) return { kind: "not_found" };
	if (target.status === "merged")
		return { kind: "invalid", message: "The target issue is merged into another issue." };
	for (const id of sources) {
		const source = await issueRow(ports, id);
		if (!source) return { kind: "invalid", message: `Source issue ${id} not found.` };
		if (source.status === "merged")
			return { kind: "invalid", message: `Source issue ${id} is already merged.` };
		if (source.project_id !== target.project_id) {
			return { kind: "invalid", message: `Source issue ${id} is in another project.` };
		}
	}
	if (!options.skipApproval && ports.config.requireApproval.includes("merge")) {
		return requestApproval(ports, actor, "merge", targetId, { source_ids: sources });
	}

	const now = ports.clock.now();
	const statements: Statement[] = [
		activityStatement(
			actor,
			"issue.merge",
			{ type: "issue", id: targetId },
			{ source_ids: sources },
			now,
		),
	];
	for (const id of sources) {
		statements.push(
			sql`UPDATE issues SET
					times_seen = times_seen + (SELECT times_seen FROM issues WHERE id = ${id}),
					first_seen = min(first_seen, (SELECT first_seen FROM issues WHERE id = ${id})),
					last_seen = max(last_seen, (SELECT last_seen FROM issues WHERE id = ${id}))
				WHERE id = ${targetId}`,
			sql`UPDATE events SET issue_id = ${targetId} WHERE issue_id = ${id}`,
			// Hourly counts and users move to the target; the source keeps no copy.
			sql`INSERT INTO issue_counts (issue_id, hour, count)
				SELECT ${targetId}, hour, count FROM issue_counts WHERE issue_id = ${id} AND true
				ON CONFLICT (issue_id, hour) DO UPDATE SET count = count + excluded.count`,
			sql`DELETE FROM issue_counts WHERE issue_id = ${id}`,
			sql`INSERT INTO issue_users (issue_id, user_hash, first_seen)
				SELECT ${targetId}, user_hash, first_seen FROM issue_users WHERE issue_id = ${id} AND true
				ON CONFLICT (issue_id, user_hash) DO NOTHING`,
			sql`DELETE FROM issue_users WHERE issue_id = ${id}`,
			sql`UPDATE issues SET status = 'merged', merged_into = ${targetId}, stored_events = 0, users_affected = 0,
					status_changed_at = ${now.toISOString()} WHERE id = ${id}`,
		);
	}
	statements.push(
		sql`UPDATE issues SET stored_events = (SELECT COUNT(*) FROM events WHERE events.issue_id = issues.id),
				users_affected = (SELECT COUNT(*) FROM issue_users WHERE issue_users.issue_id = issues.id)
			WHERE id = ${targetId}`,
	);
	await ports.db.batch(statements);
	return { kind: "done" };
}

// --- approvals ------------------------------------------------------------------------------

async function requestApproval(
	ports: P,
	actor: Actor,
	action: string,
	issueId: number,
	payload: unknown,
): Promise<ActionResult> {
	const now = ports.clock.now();
	const expires = new Date(now.getTime() + APPROVAL_DAYS * 86_400_000);
	const [inserted] = await ports.db.batch([
		sql`INSERT INTO approvals (action, issue_id, payload, requested_by_type, requested_by_id, requested_by,
				requested_at, expires_at)
			VALUES (${action}, ${issueId}, ${JSON.stringify(payload)}, ${actor.type}, ${actor.id}, ${actor.name},
				${now.toISOString()}, ${expires.toISOString()})
			RETURNING id`,
		activityStatement(
			actor,
			"approval.request",
			{ type: "issue", id: issueId },
			{ action, ...(payload as object) },
			now,
		),
	]);
	return { kind: "approval_required", approvalId: Number(inserted?.rows[0]?.id) };
}

export type ApprovalRow = Record<string, string | number | null>;

export async function listApprovals(ports: P, limit: number): Promise<ApprovalRow[]> {
	await expireApprovals(ports);
	const rows = await ports.db.all<ApprovalRow>(
		sql`SELECT id, action, issue_id, payload, requested_by, requested_at, expires_at, status, decided_by, decided_at
			FROM approvals ORDER BY id DESC LIMIT ${limit}`,
	);
	return rows.map((row) => ({
		...row,
		payload: row.payload === null ? null : JSON.parse(String(row.payload)),
	}));
}

async function expireApprovals(ports: P): Promise<void> {
	await ports.db.run(
		sql`UPDATE approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < ${ports.clock.now().toISOString()}`,
	);
}

export type DecisionResult =
	| "done"
	| "not_found"
	| "not_pending"
	| "own_request"
	| { failed: string };

/** Approves (runs the action) or rejects a pending approval. */
export async function decideApproval(
	ports: P,
	actor: Actor,
	approvalId: number,
	decision: "approve" | "reject",
): Promise<DecisionResult> {
	await expireApprovals(ports);
	const approval = await ports.db.first<{
		action: string;
		issue_id: number;
		payload: string;
		status: string;
		requested_by_type: string;
		requested_by_id: number | null;
	}>(
		sql`SELECT action, issue_id, payload, status, requested_by_type, requested_by_id FROM approvals WHERE id = ${approvalId}`,
	);
	if (!approval) return "not_found";
	if (approval.status !== "pending") return "not_pending";
	const ownRequest =
		approval.requested_by_type === actor.type && approval.requested_by_id === actor.id;
	if (ownRequest && actor.type !== "admin_token") return "own_request";

	const now = ports.clock.now();
	// Mark first, only while it is still pending: a second approve cannot run the action twice.
	const [marked] = await ports.db.batch([
		sql`UPDATE approvals SET status = ${decision === "approve" ? "approved" : "rejected"}, decided_by = ${actor.name},
				decided_at = ${now.toISOString()}
			WHERE id = ${approvalId} AND status = 'pending'`,
		activityStatement(
			actor,
			`approval.${decision}`,
			{ type: "issue", id: approval.issue_id },
			{ approval_id: approvalId, action: approval.action },
			now,
		),
	]);
	if ((marked?.changes ?? 0) === 0) return "not_pending";
	if (decision === "reject") return "done";

	const payload = JSON.parse(approval.payload) as { status?: IssueStatus; source_ids?: number[] };
	const result =
		approval.action === "merge"
			? await mergeIssues(ports, actor, approval.issue_id, payload.source_ids ?? [], {
					skipApproval: true,
				})
			: payload.status
				? await setIssueStatus(ports, actor, approval.issue_id, payload.status, {
						skipApproval: true,
					})
				: ({ kind: "invalid", message: "The request has no action." } as const);
	if (result.kind !== "done") {
		// The issue changed after the request (for example, it was merged): the action cannot run.
		const reason =
			result.kind === "invalid" ? result.message : "The issue does not exist or is merged.";
		await ports.db.run(sql`UPDATE approvals SET status = 'failed' WHERE id = ${approvalId}`);
		return { failed: reason };
	}
	return "done";
}

// --- split -----------------------------------------------------------------------------------

export const MAX_SPLIT_EVENTS = 100;

export type SplitResult =
	| { kind: "done"; newIssueId: number }
	| { kind: "not_found" }
	| { kind: "invalid"; message: string };

/**
 * Moves stored events of an issue to a new issue (the opposite of a merge). The new issue
 * gets the title of the first moved event, and the hourly counts of the moved events. New
 * events keep going to the original issue: a split does not change grouping.
 */
export async function splitIssue(
	ports: P,
	actor: Actor,
	issueId: number,
	eventIds: number[],
): Promise<SplitResult> {
	const ids = [...new Set(eventIds)];
	if (ids.length === 0 || ids.length > MAX_SPLIT_EVENTS) {
		return { kind: "invalid", message: `Give 1 to ${MAX_SPLIT_EVENTS} event IDs.` };
	}
	const issue = await ports.db.first<{
		project_id: number;
		status: string;
		fingerprint: string;
		fingerprint_version: number;
	}>(
		sql`SELECT project_id, status, fingerprint, fingerprint_version FROM issues WHERE id = ${issueId}`,
	);
	if (!issue || issue.status === "merged") return { kind: "not_found" };

	// One bound parameter for all IDs (a JSON array): it keeps the statement under 100 parameters.
	const idList = JSON.stringify(ids);
	const events = await ports.db.all<{
		id: number;
		issue_id: number;
		received_at: string;
		data: string;
	}>(
		sql`SELECT id, issue_id, received_at, data FROM events WHERE id IN (SELECT value FROM json_each(${idList})) ORDER BY id`,
	);
	if (events.length !== ids.length || events.some((e) => e.issue_id !== issueId)) {
		return { kind: "invalid", message: "Each event must be a stored event of this issue." };
	}

	const first = events[0] as (typeof events)[number];
	const event = JSON.parse(first.data) as NormalizedEvent;
	const title = issueTitle(event);
	const received = events.map((e) => e.received_at).sort();
	const fingerprint = `${issue.fingerprint}:split:${crypto.randomUUID().replace(/-/g, "")}`;
	const now = ports.clock.now();
	const perHour = new Map<string, number>();
	for (const e of events)
		perHour.set(e.received_at.slice(0, 13), (perHour.get(e.received_at.slice(0, 13)) ?? 0) + 1);

	const statements: Statement[] = [
		sql`INSERT INTO issues (project_id, fingerprint, fingerprint_version, title, culprit, type, level, platform,
				first_seen, last_seen, first_release, last_release, times_seen, stored_events, status_changed_at)
			VALUES (${issue.project_id}, ${fingerprint}, ${issue.fingerprint_version}, ${title.title}, ${title.culprit},
				${title.type}, ${event.level}, ${event.platform}, ${received[0] ?? now.toISOString()},
				${received.at(-1) ?? now.toISOString()}, ${event.release}, ${event.release}, ${events.length},
				${events.length}, ${now.toISOString()})`,
		sql`UPDATE events
			SET issue_id = (SELECT id FROM issues WHERE project_id = ${issue.project_id} AND fingerprint = ${fingerprint})
			WHERE id IN (SELECT value FROM json_each(${idList}))`,
	];
	for (const [hour, count] of perHour) {
		statements.push(
			sql`UPDATE issue_counts SET count = max(0, count - ${count}) WHERE issue_id = ${issueId} AND hour = ${hour}`,
			{
				sql: `INSERT INTO issue_counts (issue_id, hour, count) SELECT id, ?, ? FROM issues
					WHERE project_id = ? AND fingerprint = ?`,
				params: [hour, count, issue.project_id, fingerprint],
			},
		);
	}
	statements.push(
		sql`UPDATE issues SET times_seen = max(1, times_seen - ${events.length}),
				stored_events = (SELECT COUNT(*) FROM events WHERE events.issue_id = issues.id)
			WHERE id = ${issueId}`,
		{
			sql: `INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
				SELECT ?, ?, ?, ?, 'issue.split', 'issue', ?, json_object('new_issue_id', id, 'event_ids', json(?))
				FROM issues WHERE project_id = ? AND fingerprint = ?`,
			params: [
				now.toISOString(),
				actor.type,
				actor.id,
				actor.name,
				issueId,
				idList,
				issue.project_id,
				fingerprint,
			],
		},
		{
			sql: `INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
				SELECT ?, ?, ?, ?, 'issue.split_from', 'issue', id, json_object('issue_id', ?)
				FROM issues WHERE project_id = ? AND fingerprint = ?`,
			params: [
				now.toISOString(),
				actor.type,
				actor.id,
				actor.name,
				issueId,
				issue.project_id,
				fingerprint,
			],
		},
	);
	await ports.db.batch(statements);
	const created = await ports.db.first<{ id: number }>(
		sql`SELECT id FROM issues WHERE project_id = ${issue.project_id} AND fingerprint = ${fingerprint}`,
	);
	return { kind: "done", newIssueId: Number(created?.id) };
}
