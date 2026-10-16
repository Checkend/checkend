import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

/**
 * The dashboard: what a person needs when they look in from time to time. What changed since
 * the last visit, what needs a person, and whether the fix loop works. Reads only, except the
 * visit time of the member. Test issues and deleted apps are left out everywhere.
 */

type P = Pick<Ports, "db" | "clock">;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A new visit starts after this long away. */
export const VISIT_GAP_MS = 30 * MINUTE;
/** "Since your last visit" looks back at most this far. */
export const MAX_WINDOW_MS = 30 * DAY;
/** Agents get this long to claim a new issue before it needs a person. */
export const CLAIM_GRACE_MS = HOUR;
/** A linked fix that is not deployed after this long needs a person. */
export const DEPLOY_GRACE_MS = DAY;
/** Open issues not seen for this long do not need a person now. */
const RECENT_MS = 7 * DAY;
/** Items of one kind in "Needs you". */
export const ATTENTION_LIMIT = 5;
const ACTIVITY_LIMIT = 12;

export interface Visit {
	/** The start of the "since your last visit" window. */
	since: string;
	/** The end of the previous visit; null on the first visit. */
	previous: string | null;
}

/**
 * Records a dashboard view of a member and returns the window since the previous visit. A view
 * more than 30 minutes after the last one starts a new visit. One UPDATE, at most once a minute.
 */
export async function recordVisit({ db, clock }: P, memberId: number): Promise<Visit> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const gap = new Date(now.getTime() - VISIT_GAP_MS).toISOString();
	const minute = new Date(now.getTime() - MINUTE).toISOString();
	await db.run(
		sql`UPDATE members SET
				previous_visit_at = CASE WHEN last_visit_at IS NOT NULL AND last_visit_at < ${gap}
					THEN last_visit_at ELSE previous_visit_at END,
				last_visit_at = ${nowIso}
			WHERE id = ${memberId} AND (last_visit_at IS NULL OR last_visit_at < ${minute})`,
	);
	const row = await db.first<{ previous_visit_at: string | null }>(
		sql`SELECT previous_visit_at FROM members WHERE id = ${memberId}`,
	);
	const previous = row?.previous_visit_at ?? null;
	const floor = new Date(now.getTime() - MAX_WINDOW_MS).toISOString();
	const since = previous
		? previous < floor
			? floor
			: previous
		: new Date(now.getTime() - DAY).toISOString();
	return { since, previous };
}

export interface DashboardIssue {
	id: number;
	title: string;
	status: string;
	/** The public project ID. */
	project_id: number;
	project_name: string;
}

export const ATTENTION_KINDS = [
	"approval",
	"regressed",
	"still_failing",
	"not_deployed",
	"expired_claim",
	"unclaimed",
	"quota",
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export interface AttentionItem {
	kind: AttentionKind;
	issue: DashboardIssue | null;
	/** The app, for items about an app (quota). */
	app: { id: number; name: string } | null;
	/** The time that matters for the kind: requested, regressed, last seen, linked, expired. */
	at: string | null;
	/** Who asked for the approval, or held the claim. */
	actor: string | null;
	/** The approval action, the release of a regression, the fix ref, or the quota. */
	detail: string | null;
	/** not_deployed: false when the app never reported a deploy (so no fix can be verified). */
	app_has_deploys: boolean | null;
}

export interface FixLoop {
	/** Unresolved, no active claim. */
	open: number;
	/** Unresolved, an agent holds a claim. */
	claimed: number;
	/** fix_pending, the fix is not deployed yet. */
	fix_linked: number;
	/** fix_pending, deployed: waiting for the quiet period. */
	fix_deployed: number;
	regressed: number;
	/** Verified in the last 7 days. */
	verified_7d: number;
}

export interface ActivityItem {
	id: number;
	at: string;
	actor_type: string;
	actor_name: string;
	action: string;
	/** Parsed JSON data of the row (untrusted: it can contain agent text). */
	data: Record<string, unknown> | null;
	issue: DashboardIssue | null;
	app: { id: number; name: string } | null;
}

export interface AppHealth {
	id: number;
	name: string;
	/** Events per hour, the oldest first; the last value is the current hour. */
	hourly: number[];
	events_24h: number;
	open_issues: number;
	last_event_at: string | null;
	last_deploy_at: string | null;
	daily_quota: number | null;
	events_today: number;
}

export interface Dashboard {
	since: string;
	summary: { new_issues: number; verified: number; regressed: number; agent_actions: number };
	attention: AttentionItem[];
	/** The number of items of each kind (the list shows at most ATTENTION_LIMIT). */
	totals: Record<AttentionKind, number>;
	loop: FixLoop;
	activity: ActivityItem[];
	apps: AppHealth[];
	outcomes: { verified: number; regressed: number; median_hours_to_verified: number | null };
}

type Row = Record<string, string | number | null>;

const num = (value: unknown): number => Number(value ?? 0);
const str = (value: unknown): string | null =>
	value === null || value === undefined ? null : String(value);

function issueOf(row: Row): DashboardIssue | null {
	if (row.issue_id === null || row.issue_id === undefined) return null;
	return {
		id: num(row.issue_id),
		title: String(row.issue_title ?? ""),
		status: String(row.issue_status ?? ""),
		project_id: num(row.project_id),
		project_name: String(row.project_name ?? ""),
	};
}

function attentionOf(kind: AttentionKind, row: Row): AttentionItem {
	return {
		kind,
		issue: issueOf(row),
		app: null,
		at: str(row.at),
		actor: str(row.actor),
		detail: str(row.detail),
		app_has_deploys: row.app_has_deploys === undefined ? null : num(row.app_has_deploys) > 0,
	};
}

function parseData(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "string") return null;
	try {
		const parsed: unknown = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const value =
		sorted.length % 2 === 1
			? (sorted[mid] ?? 0)
			: ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
	return Math.round(value * 10) / 10;
}

/**
 * Each app with its events per hour (the last 24 hours), open issues, last event and last deploy:
 * for the dashboard and the Apps list.
 */
export async function loadAppHealth(db: Db, now: Date): Promise<AppHealth[]> {
	const nowIso = now.toISOString();
	const hour24 = new Date(now.getTime() - DAY).toISOString().slice(0, 13);
	const today = `${nowIso.slice(0, 10)}T00`;
	const [apps, hourly] = await Promise.all([
		db.all<Row>(
			sql`SELECT p.public_id AS id, p.name, p.daily_quota,
					(SELECT count(*) FROM issues i WHERE i.project_id = p.id AND i.test = 0
						AND i.status IN ('unresolved', 'regressed', 'fix_pending')) AS open_issues,
					(SELECT max(d.deployed_at) FROM deploys d WHERE d.project_id = p.id) AS last_deploy_at,
					(SELECT max(i.last_seen) FROM issues i WHERE i.project_id = p.id AND i.test = 0)
						AS last_event_at
				FROM projects p WHERE p.deleted_at IS NULL ORDER BY p.name, p.id`,
		),
		// The quota counts every event (as ingest does); the chart leaves out test issues.
		db.all<Row>(
			sql`SELECT p.public_id AS id, c.hour,
					sum(CASE WHEN i.test = 0 THEN c.count ELSE 0 END) AS n, sum(c.count) AS all_n
				FROM issue_counts c JOIN issues i ON i.id = c.issue_id JOIN projects p ON p.id = i.project_id
				WHERE c.hour > ${hour24} AND p.deleted_at IS NULL
				GROUP BY p.public_id, c.hour`,
		),
	]);
	// The 24 hour keys of the chart, the oldest first.
	const hours = Array.from({ length: 24 }, (_, n) =>
		new Date(now.getTime() - (23 - n) * HOUR).toISOString().slice(0, 13),
	);
	const counts = new Map<string, { n: number; all: number }>();
	for (const row of hourly) {
		counts.set(`${row.id}|${row.hour}`, { n: num(row.n), all: num(row.all_n) });
	}
	return apps.map((row) => {
		const series = hours.map((hour) => counts.get(`${row.id}|${hour}`)?.n ?? 0);
		const eventsToday = hours
			.filter((hour) => hour >= today)
			.reduce((sum, hour) => sum + (counts.get(`${row.id}|${hour}`)?.all ?? 0), 0);
		return {
			id: num(row.id),
			name: String(row.name ?? ""),
			hourly: series,
			events_24h: series.reduce((a, b) => a + b, 0),
			open_issues: num(row.open_issues),
			last_event_at: str(row.last_event_at),
			last_deploy_at: str(row.last_deploy_at),
			daily_quota: row.daily_quota === null ? null : num(row.daily_quota),
			events_today: eventsToday,
		};
	});
}

/** All the reads of the dashboard, in parallel. `since`: the start of the visit window. */
export async function loadDashboard({ db, clock }: P, since: Date): Promise<Dashboard> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const sinceIso = since.toISOString();
	const week = new Date(now.getTime() - 7 * DAY).toISOString();
	const recent = new Date(now.getTime() - RECENT_MS).toISOString();
	const claimGrace = new Date(now.getTime() - CLAIM_GRACE_MS).toISOString();
	const deployGrace = new Date(now.getTime() - DEPLOY_GRACE_MS).toISOString();
	const limit = ATTENTION_LIMIT;

	const [
		newIssues,
		fixesSince,
		agentActions,
		approvals,
		regressed,
		stillFailing,
		notDeployed,
		expired,
		unclaimed,
		loop,
		activity,
		appHealth,
		outcomes,
	] = await Promise.all([
		db.first<Row>(
			sql`SELECT count(*) AS n FROM issues i JOIN projects p ON p.id = i.project_id
				WHERE i.first_seen >= ${sinceIso} AND i.test = 0 AND i.status != 'merged'
					AND p.deleted_at IS NULL`,
		),
		db.first<Row>(
			sql`SELECT coalesce(sum(f.verified_at >= ${sinceIso}), 0) AS verified,
					coalesce(sum(f.regressed_at >= ${sinceIso}), 0) AS regressed
				FROM fixes f JOIN issues i ON i.id = f.issue_id JOIN projects p ON p.id = i.project_id
				WHERE (f.verified_at >= ${sinceIso} OR f.regressed_at >= ${sinceIso})
					AND i.test = 0 AND p.deleted_at IS NULL`,
		),
		// Agent actions: rows by agent tokens. Deploy records (by CI) are not agent actions.
		db.first<Row>(
			sql`SELECT count(*) AS n FROM activity
				WHERE at >= ${sinceIso} AND actor_type IN ('token', 'setup_key')
					AND action NOT IN ('release.deploy', 'issue.fix_deployed')`,
		),
		db.all<Row>(
			sql`SELECT a.action AS detail, a.requested_by AS actor, a.requested_at AS at,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM approvals a JOIN issues i ON i.id = a.issue_id JOIN projects p ON p.id = i.project_id
				WHERE a.status = 'pending' AND a.expires_at > ${nowIso} AND p.deleted_at IS NULL
				ORDER BY a.id DESC LIMIT ${limit}`,
		),
		db.all<Row>(
			sql`SELECT f.regressed_in AS detail, coalesce(f.regressed_at, i.status_changed_at) AS at,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM issues i JOIN projects p ON p.id = i.project_id
				LEFT JOIN fixes f ON f.id = (SELECT max(id) FROM fixes WHERE issue_id = i.id)
				WHERE i.status = 'regressed' AND i.test = 0 AND p.deleted_at IS NULL
				ORDER BY i.last_seen DESC, i.id DESC LIMIT ${limit}`,
		),
		// Deployed, but an event came after the deploy that Checkend cannot place in an older
		// release: the quiet period started again.
		db.all<Row>(
			sql`SELECT f.ref AS detail, i.last_seen AS at,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM issues i JOIN projects p ON p.id = i.project_id
				JOIN fixes f ON f.id = (SELECT max(id) FROM fixes WHERE issue_id = i.id)
				WHERE i.status = 'fix_pending' AND f.outcome IS NULL AND f.deployed_at IS NOT NULL
					AND f.quiet_since > f.deployed_at AND i.test = 0 AND p.deleted_at IS NULL
				ORDER BY i.last_seen DESC, i.id DESC LIMIT ${limit}`,
		),
		db.all<Row>(
			sql`SELECT f.ref AS detail, f.linked_at AS at, f.linked_by AS actor,
					EXISTS (SELECT 1 FROM deploys d WHERE d.project_id = i.project_id) AS app_has_deploys,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM issues i JOIN projects p ON p.id = i.project_id
				JOIN fixes f ON f.id = (SELECT max(id) FROM fixes WHERE issue_id = i.id)
				WHERE i.status = 'fix_pending' AND f.outcome IS NULL AND f.deployed_at IS NULL
					AND f.linked_at <= ${deployGrace} AND i.test = 0 AND p.deleted_at IS NULL
				ORDER BY f.linked_at, i.id LIMIT ${limit}`,
		),
		db.all<Row>(
			sql`SELECT i.claimed_by AS actor, i.claim_expires_at AS at,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM issues i JOIN projects p ON p.id = i.project_id
				WHERE i.status = 'unresolved' AND i.claimed_by IS NOT NULL
					AND i.claim_expires_at <= ${nowIso} AND i.last_seen >= ${recent}
					AND i.test = 0 AND p.deleted_at IS NULL
				ORDER BY i.claim_expires_at DESC, i.id DESC LIMIT ${limit}`,
		),
		db.all<Row>(
			sql`SELECT i.last_seen AS at, CAST(i.times_seen AS TEXT) AS detail,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					p.public_id AS project_id, p.name AS project_name, count(*) OVER () AS total
				FROM issues i JOIN projects p ON p.id = i.project_id
				WHERE i.status = 'unresolved' AND i.claimed_by IS NULL
					AND i.first_seen <= ${claimGrace} AND i.last_seen >= ${recent}
					AND i.test = 0 AND p.deleted_at IS NULL
				ORDER BY i.last_seen DESC, i.id DESC LIMIT ${limit}`,
		),
		db.first<Row>(
			sql`SELECT
					coalesce(sum(i.status = 'unresolved'
						AND (i.claim_expires_at IS NULL OR i.claim_expires_at <= ${nowIso})), 0) AS open,
					coalesce(sum(i.status = 'unresolved' AND i.claim_expires_at > ${nowIso}), 0) AS claimed,
					coalesce(sum(i.status = 'fix_pending' AND f.deployed_at IS NULL), 0) AS fix_linked,
					coalesce(sum(i.status = 'fix_pending' AND f.deployed_at IS NOT NULL), 0) AS fix_deployed,
					coalesce(sum(i.status = 'regressed'), 0) AS regressed,
					coalesce(sum(i.status = 'verified' AND i.status_changed_at >= ${week}), 0) AS verified_7d
				FROM issues i JOIN projects p ON p.id = i.project_id
				LEFT JOIN fixes f ON f.id = (SELECT max(id) FROM fixes WHERE issue_id = i.id)
				WHERE i.test = 0 AND p.deleted_at IS NULL
					AND i.status IN ('unresolved', 'fix_pending', 'regressed', 'verified')`,
		),
		db.all<Row>(
			sql`SELECT a.id, a.at, a.actor_type, a.actor_name, a.action, a.data,
					i.id AS issue_id, i.title AS issue_title, i.status AS issue_status,
					coalesce(ip.public_id, pp.public_id, rp.public_id) AS project_id,
					coalesce(ip.name, pp.name, rp.name) AS project_name
				FROM activity a
				LEFT JOIN issues i ON a.target_type = 'issue' AND i.id = a.target_id
				LEFT JOIN projects ip ON ip.id = i.project_id
				LEFT JOIN projects pp ON a.target_type = 'project' AND pp.id = a.target_id
				LEFT JOIN releases r ON a.target_type = 'release' AND r.id = a.target_id
				LEFT JOIN projects rp ON rp.id = r.project_id
				WHERE coalesce(i.test, 0) = 0
					AND coalesce(ip.deleted_at, pp.deleted_at, rp.deleted_at) IS NULL
				ORDER BY a.id DESC LIMIT ${ACTIVITY_LIMIT}`,
		),
		loadAppHealth(db, now),
		db.all<Row>(
			sql`SELECT o.verified_at, o.regressed_at, o.hours_to_verified
				FROM fix_outcomes o JOIN issues i ON i.id = o.issue_id JOIN projects p ON p.id = i.project_id
				WHERE (o.verified_at >= ${week} OR o.regressed_at >= ${week})
					AND i.test = 0 AND p.deleted_at IS NULL
				LIMIT ${1000}`,
		),
	]);

	const quota: AttentionItem[] = appHealth
		.filter((a) => a.daily_quota !== null && a.events_today >= a.daily_quota)
		.map((a) => ({
			kind: "quota",
			issue: null,
			app: { id: a.id, name: a.name },
			at: null,
			actor: null,
			detail: String(a.daily_quota),
			app_has_deploys: null,
		}));

	const lists: [AttentionKind, Row[]][] = [
		["approval", approvals],
		["regressed", regressed],
		["still_failing", stillFailing],
		["not_deployed", notDeployed],
		["expired_claim", expired],
		["unclaimed", unclaimed],
	];
	const totals = Object.fromEntries(ATTENTION_KINDS.map((k) => [k, 0])) as Record<
		AttentionKind,
		number
	>;
	for (const [kind, rows] of lists) totals[kind] = num(rows[0]?.total);
	totals.quota = quota.length;

	return {
		since: sinceIso,
		summary: {
			new_issues: num(newIssues?.n),
			verified: num(fixesSince?.verified),
			regressed: num(fixesSince?.regressed),
			agent_actions: num(agentActions?.n),
		},
		attention: [
			...lists.flatMap(([kind, rows]) => rows.map((row) => attentionOf(kind, row))),
			...quota,
		],
		totals,
		loop: {
			open: num(loop?.open),
			claimed: num(loop?.claimed),
			fix_linked: num(loop?.fix_linked),
			fix_deployed: num(loop?.fix_deployed),
			regressed: num(loop?.regressed),
			verified_7d: num(loop?.verified_7d),
		},
		activity: activity.map((row) => ({
			id: num(row.id),
			at: String(row.at),
			actor_type: String(row.actor_type),
			actor_name: String(row.actor_name),
			action: String(row.action),
			data: parseData(row.data),
			issue: issueOf(row),
			app:
				row.project_id === null || row.project_id === undefined
					? null
					: { id: num(row.project_id), name: String(row.project_name ?? "") },
		})),
		apps: appHealth,
		outcomes: {
			verified: outcomes.filter((o) => o.verified_at !== null && String(o.verified_at) >= week)
				.length,
			regressed: outcomes.filter((o) => o.regressed_at !== null && String(o.regressed_at) >= week)
				.length,
			median_hours_to_verified: median(
				outcomes
					.filter((o) => o.verified_at !== null && String(o.verified_at) >= week)
					.filter((o) => o.hours_to_verified !== null)
					.map((o) => num(o.hours_to_verified)),
			),
		},
	};
}
