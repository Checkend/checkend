import * as v from "valibot";
import { type Db, type SqlValue, type Statement, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import { findProjectRowId, ProjectRef, parseSince, SINCE_PATTERN } from "./issues.ts";
import { projectRepository } from "./projects.ts";
import type { Actor } from "./tokens.ts";
import { verifiedDeliveryStatement } from "./webhooks.ts";

/**
 * The fix loop. An agent links a fix (a commit SHA or a pull request URL) to an issue: the
 * status becomes fix_pending. CI reports deploys; a deploy contains a fix when it lists the
 * fix commit or pull request. A release contains the fix when one of its deploys is in the
 * same environment as, and not before, a deploy that contains the fix. Then:
 * - the error stops for the quiet period → verified (the scheduler, verifyFixes);
 * - the error comes back in a release that contains the fix → regressed (at ingest).
 */

/** A commit SHA: 7 to 40 hex characters, lowercase. */
export const CommitSha = v.pipe(
	v.string(),
	v.regex(/^[0-9a-fA-F]{7,40}$/),
	v.transform((sha) => sha.toLowerCase()),
);

/** A pull request URL on a connected host (GitHub). */
export const PullRequestUrl = v.pipe(
	v.string(),
	v.regex(
		/^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\/pull\/[1-9]\d{0,9}$/,
	),
);

export const LinkFixBody = v.union([
	v.strictObject({ commit: CommitSha }),
	v.strictObject({ pr_url: PullRequestUrl }),
]);
export type LinkFixBody = v.InferOutput<typeof LinkFixBody>;

const Name = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200));

export const DeployBody = v.object({
	/** The public project ID (a number or a string) or the slug. */
	project: v.union([
		ProjectRef,
		v.pipe(v.number(), v.integer(), v.minValue(1), v.transform(String)),
	]),
	commit: CommitSha,
	/** The release version; the default is the commit SHA. */
	release: v.optional(Name),
	environment: v.optional(Name, "production"),
	/** Commits since the last deploy (for example `git rev-list <previous>..HEAD`). */
	commits: v.optional(v.pipe(v.array(CommitSha), v.maxLength(1000)), []),
	pull_requests: v.optional(v.pipe(v.array(PullRequestUrl), v.maxLength(100)), []),
});
export type DeployInput = v.InferOutput<typeof DeployBody>;

export const ReleaseListQuery = v.object({
	project: v.optional(ProjectRef),
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1), v.maxValue(100)),
		"25",
	),
});

export const ReleaseQuery = v.object({ project: ProjectRef });

export const FixOutcomeQuery = v.object({
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,4}$/), v.transform(Number), v.minValue(1), v.maxValue(1000)),
		"100",
	),
	since: v.optional(v.pipe(v.string(), v.regex(SINCE_PATTERN))),
});

/** Hours without the error, after the deploy, before a fix is verified. */
export const DEFAULT_QUIET_HOURS = 24;

/** Fixes verified per scheduler run; the next run takes the rest. */
const VERIFY_BATCH = 50;

/** A deploy ref `x` matches the fix `f`: the same PR URL, or commit SHAs with the same prefix. */
const REF_MATCHES = `x.kind = f.kind AND (x.ref = f.ref OR (f.kind = 'commit'
	AND (substr(x.ref, 1, length(f.ref)) = f.ref OR substr(f.ref, 1, length(x.ref)) = x.ref)))`;

/**
 * True when the release (project row ID, version: 2 parameters) contains the fix `f`: one of
 * its deploys is at or after a deploy that contains the fix, in the same environment.
 */
const RELEASE_CONTAINS_FIX = `EXISTS (SELECT 1 FROM releases r
	JOIN deploys d ON d.release_id = r.id
	JOIN deploys d0 ON d0.project_id = d.project_id AND d0.environment = d.environment AND d0.id <= d.id
	JOIN deploy_refs x ON x.deploy_id = d0.id
	WHERE r.project_id = ? AND r.version = ? AND ${REF_MATCHES})`;

/** The current fix of each issue is its latest fix. */
const CURRENT_FIX = "f.id = (SELECT max(id) FROM fixes WHERE issue_id = i.id)";

const DUPLICATE_EVENT = "EXISTS (SELECT 1 FROM events WHERE project_id = ? AND event_id = ?)";

// Ingest: an event in a release that contains the fix regresses the issue. Parameters are in
// the order of the `?` marks; see fixStatementsForEvent.
const REGRESS_ACTIVITY_SQL = `INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
	SELECT ?, 'system', NULL, 'ingest', 'issue.regress', 'issue', i.id,
		json_object('from', i.status, 'to', 'regressed', 'release', ?, 'event_id', ?, 'fix_id', f.id)
	FROM issues i JOIN fixes f ON ${CURRENT_FIX}
	WHERE i.project_id = ? AND i.fingerprint = ? AND i.status IN ('fix_pending', 'verified')
		AND NOT ${DUPLICATE_EVENT} AND ${RELEASE_CONTAINS_FIX}`;
const REGRESS_FIX_SQL = `UPDATE fixes AS f SET outcome = 'regressed', regressed_at = ?, regressed_in = ?
	WHERE f.id = (SELECT max(f2.id) FROM fixes f2 JOIN issues i ON i.id = f2.issue_id
			WHERE i.project_id = ? AND i.fingerprint = ? AND i.status IN ('fix_pending', 'verified'))
		AND (f.outcome IS NULL OR f.outcome = 'verified')
		AND NOT ${DUPLICATE_EVENT} AND ${RELEASE_CONTAINS_FIX}`;
const REGRESS_ISSUE_SQL = `UPDATE issues AS i SET status = 'regressed', status_changed_at = ?
	WHERE i.project_id = ? AND i.fingerprint = ? AND i.status IN ('fix_pending', 'verified')
		AND EXISTS (SELECT 1 FROM fixes f WHERE ${CURRENT_FIX} AND f.outcome = 'regressed')`;
// An event that Checkend cannot place in an older release (no release, or a release without a
// deploy) starts the quiet period again: it can come from code with the fix.
const QUIET_RESET_SQL = `UPDATE fixes AS f SET quiet_since = ?
	WHERE f.id = (SELECT max(f2.id) FROM fixes f2 JOIN issues i ON i.id = f2.issue_id
			WHERE i.project_id = ? AND i.fingerprint = ?)
		AND f.outcome IS NULL AND f.deployed_at IS NOT NULL AND NOT ${DUPLICATE_EVENT}
		AND NOT EXISTS (SELECT 1 FROM releases r JOIN deploys d ON d.release_id = r.id
			WHERE r.project_id = ? AND r.version = ?)`;

/**
 * Statements for the ingest batch of one event (before the event insert: the duplicate check
 * looks for the event_id in events).
 */
export function fixStatementsForEvent(
	projectId: number,
	fingerprint: string,
	eventId: string,
	release: string | null,
	nowIso: string,
): Statement[] {
	const quietReset: Statement = {
		sql: QUIET_RESET_SQL,
		params: [nowIso, projectId, fingerprint, projectId, eventId, projectId, release],
	};
	if (release === null) return [quietReset];
	const contains: SqlValue[] = [projectId, release];
	return [
		{
			sql: REGRESS_ACTIVITY_SQL,
			params: [nowIso, release, eventId, projectId, fingerprint, projectId, eventId, ...contains],
		},
		{
			sql: REGRESS_FIX_SQL,
			params: [nowIso, release, projectId, fingerprint, projectId, eventId, ...contains],
		},
		{ sql: REGRESS_ISSUE_SQL, params: [nowIso, projectId, fingerprint] },
		quietReset,
	];
}

type P = Pick<Ports, "db" | "clock" | "config">;

const FIRST_DEPLOY_WITH_REF_SQL = `SELECT d.id, d.deployed_at FROM deploys d
	JOIN deploy_refs x ON x.deploy_id = d.id
	JOIN (SELECT ? AS kind, ? AS ref) f
	WHERE d.project_id = ? AND ${REF_MATCHES}
	ORDER BY d.id LIMIT 1`;

/** Links a fix to an issue: status fix_pending. A fix that is already deployed counts. */
export async function linkFix(
	ports: P,
	actor: Actor,
	issueId: number,
	body: LinkFixBody,
): Promise<"done" | "not_found" | { invalid: string }> {
	const issue = await ports.db.first<{ project_id: number; status: string; last_seen: string }>(
		sql`SELECT project_id, status, last_seen FROM issues WHERE id = ${issueId} AND status != 'merged'`,
	);
	if (!issue) return "not_found";
	const [kind, ref] = "commit" in body ? ["commit", body.commit] : ["pr", body.pr_url];
	// A project with a repository accepts pull requests of that repository only.
	const repository = kind === "pr" ? await projectRepository(ports.db, issue.project_id) : null;
	if (repository && !ref.toLowerCase().startsWith(`https://github.com/${repository}/pull/`)) {
		return { invalid: `The pull request must be in the repository of the project: ${repository}.` };
	}
	const deploy = await ports.db.first<{ id: number; deployed_at: string }>({
		sql: FIRST_DEPLOY_WITH_REF_SQL,
		params: [kind, ref, issue.project_id],
	});
	const now = ports.clock.now();
	const nowIso = now.toISOString();
	// Deployed before the link: the quiet period starts at the deploy, or at the last event.
	const quietSince = deploy
		? deploy.deployed_at > issue.last_seen
			? deploy.deployed_at
			: issue.last_seen
		: null;
	await ports.db.batch([
		sql`UPDATE fixes SET outcome = 'replaced' WHERE issue_id = ${issueId} AND outcome IS NULL`,
		sql`INSERT INTO fixes (issue_id, kind, ref, linked_by_type, linked_by_id, linked_by, linked_at,
				deploy_id, deployed_at, quiet_since)
			VALUES (${issueId}, ${kind}, ${ref}, ${actor.type}, ${actor.id}, ${actor.name}, ${nowIso},
				${deploy?.id ?? null}, ${deploy?.deployed_at ?? null}, ${quietSince})`,
		activityStatement(
			actor,
			"issue.fix",
			{ type: "issue", id: issueId },
			{ kind, ref, from: issue.status, to: "fix_pending" },
			now,
		),
		sql`UPDATE issues SET status = 'fix_pending', status_changed_at = ${nowIso} WHERE id = ${issueId}`,
	]);
	return "done";
}

export interface DeployResult {
	id: number;
	project_id: number;
	release: string;
	environment: string;
	commit: string;
	deployed_at: string;
	/** Issues whose fix this deploy contains (the first deploy with the fix). */
	fixes_deployed: number[];
}

/**
 * Commits that GitHub reported as pushed: a deploy of commit C contains the commits pushed to
 * the branch of C up to C, after the commit of the previous deploy to the same environment
 * (at most 1000). Parameter: the deploy uid.
 */
const PUSHED_REFS_SQL = `INSERT OR IGNORE INTO deploy_refs (deploy_id, kind, ref)
	SELECT d.id, 'commit', pc.sha
	FROM deploys d
	JOIN pushed_commits head ON head.id = (SELECT max(id) FROM pushed_commits
		WHERE project_id = d.project_id AND sha LIKE d.commit_sha || '%')
	JOIN pushed_commits pc ON pc.project_id = d.project_id AND pc.branch = head.branch AND pc.id <= head.id
	WHERE d.uid = ? AND pc.id > coalesce((SELECT max(p2.id) FROM deploys d2
		JOIN pushed_commits p2 ON p2.project_id = d2.project_id AND p2.branch = head.branch
			AND p2.sha LIKE d2.commit_sha || '%'
		WHERE d2.project_id = d.project_id AND d2.environment = d.environment AND d2.id < d.id), 0)
	ORDER BY pc.id DESC LIMIT 1000`;

/** Merged pull requests whose merge commit the deploy contains. Parameter: the deploy uid. */
const MERGED_PR_REFS_SQL = `INSERT OR IGNORE INTO deploy_refs (deploy_id, kind, ref)
	SELECT d.id, 'pr', m.pr_url
	FROM deploys d
	JOIN deploy_refs x ON x.deploy_id = d.id AND x.kind = 'commit'
	JOIN pr_merges m ON m.project_id = d.project_id AND m.merge_sha = x.ref
	WHERE d.uid = ?`;

const MARK_DEPLOYED_SQL = `UPDATE fixes AS f SET deploy_id = (SELECT id FROM deploys WHERE uid = ?),
		deployed_at = ?, quiet_since = ?
	WHERE f.outcome IS NULL AND f.deploy_id IS NULL
		AND f.issue_id IN (SELECT id FROM issues WHERE project_id = ?)
		AND EXISTS (SELECT 1 FROM deploy_refs x
			WHERE x.deploy_id = (SELECT id FROM deploys WHERE uid = ?) AND ${REF_MATCHES})
	RETURNING issue_id`;
const DEPLOYED_ACTIVITY_SQL = `INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
	SELECT ?, ?, ?, ?, 'issue.fix_deployed', 'issue', f.issue_id,
		json_object('release', ?, 'environment', ?, 'fix_id', f.id)
	FROM fixes f
	WHERE f.outcome IS NULL AND f.deploy_id IS NULL
		AND f.issue_id IN (SELECT id FROM issues WHERE project_id = ?)
		AND EXISTS (SELECT 1 FROM deploy_refs x
			WHERE x.deploy_id = (SELECT id FROM deploys WHERE uid = ?) AND ${REF_MATCHES})`;

/**
 * Marks the fixes that a deploy contains as deployed, after more refs were added to it (the
 * commits that the cron fetched from GitHub). The quiet period starts now.
 */
export async function markFixesDeployed(
	ports: Pick<Ports, "db" | "clock">,
	actor: Actor,
	deployUid: string,
	projectId: number,
	release: string,
	environment: string,
): Promise<void> {
	const nowIso = ports.clock.now().toISOString();
	await ports.db.batch([
		{
			sql: DEPLOYED_ACTIVITY_SQL,
			params: [
				nowIso,
				actor.type,
				actor.id,
				actor.name,
				release,
				environment,
				projectId,
				deployUid,
			],
		},
		{ sql: MARK_DEPLOYED_SQL, params: [deployUid, nowIso, nowIso, projectId, deployUid] },
	]);
}

/**
 * Records a deploy: the release (created on first use), the deploy, what it contains, and the
 * fixes it deploys. One atomic batch.
 */
export async function recordDeploy(
	ports: P,
	actor: Actor,
	input: DeployInput,
	source: "api" | "github" = "api",
): Promise<DeployResult | "project_not_found"> {
	const projectId = await findProjectRowId(ports.db, input.project);
	if (projectId === null) return "project_not_found";
	const now = ports.clock.now();
	const nowIso = now.toISOString();
	const uid = crypto.randomUUID();
	const version = input.release ?? input.commit;
	const commits = JSON.stringify([...new Set([input.commit, ...input.commits])]);
	const prs = JSON.stringify([...new Set(input.pull_requests)]);
	const results = await ports.db.batch([
		sql`INSERT INTO releases (project_id, version, commit_sha, created_at)
			VALUES (${projectId}, ${version}, ${input.commit}, ${nowIso})
			ON CONFLICT (project_id, version) DO UPDATE SET commit_sha = coalesce(commit_sha, excluded.commit_sha)`,
		sql`INSERT INTO deploys (uid, project_id, release_id, environment, commit_sha, source, deployed_at)
			SELECT ${uid}, ${projectId}, id, ${input.environment}, ${input.commit}, ${source}, ${nowIso}
			FROM releases WHERE project_id = ${projectId} AND version = ${version}`,
		sql`INSERT OR IGNORE INTO deploy_refs (deploy_id, kind, ref)
			SELECT d.id, 'commit', j.value FROM deploys d, json_each(${commits}) j WHERE d.uid = ${uid}`,
		sql`INSERT OR IGNORE INTO deploy_refs (deploy_id, kind, ref)
			SELECT d.id, 'pr', j.value FROM deploys d, json_each(${prs}) j WHERE d.uid = ${uid}`,
		{ sql: PUSHED_REFS_SQL, params: [uid] },
		{ sql: MERGED_PR_REFS_SQL, params: [uid] },
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${nowIso}, ${actor.type}, ${actor.id}, ${actor.name}, 'release.deploy', 'release', release_id,
				json_object('release', ${version}, 'environment', ${input.environment}, 'commit', ${input.commit},
					'source', ${source})
			FROM deploys WHERE uid = ${uid}`,
		{
			sql: DEPLOYED_ACTIVITY_SQL,
			params: [
				nowIso,
				actor.type,
				actor.id,
				actor.name,
				version,
				input.environment,
				projectId,
				uid,
			],
		},
		{ sql: MARK_DEPLOYED_SQL, params: [uid, nowIso, nowIso, projectId, uid] },
		sql`SELECT d.id, p.public_id FROM deploys d JOIN projects p ON p.id = d.project_id WHERE d.uid = ${uid}`,
	]);
	const fixed = (results.at(-2)?.rows ?? []).map((row) => Number(row.issue_id));
	const deploy = results.at(-1)?.rows[0];
	return {
		id: Number(deploy?.id),
		project_id: Number(deploy?.public_id),
		release: version,
		environment: input.environment,
		commit: input.commit,
		deployed_at: nowIso,
		fixes_deployed: [...new Set(fixed)].sort((a, b) => a - b),
	};
}

type ReleaseRow = Record<string, SqlValue>;

const DEPLOY_COLUMNS = 'd.id, d.environment, d.commit_sha AS "commit", d.source, d.deployed_at';
const DEPLOYS_OF_RELEASES_SQL = `SELECT d.release_id, ${DEPLOY_COLUMNS} FROM deploys d
	WHERE d.release_id IN (SELECT value FROM json_each(?)) ORDER BY d.id DESC`;
const DEPLOYS_OF_RELEASE_SQL = `SELECT ${DEPLOY_COLUMNS} FROM deploys d WHERE d.release_id = ? ORDER BY d.id DESC`;

/** Releases, the most recently deployed first, each with its deploys (the latest first). */
export async function listReleases(
	db: Db,
	query: { project?: string | undefined; limit: number },
): Promise<Record<string, unknown>[] | "project_not_found"> {
	const projectId = query.project ? await findProjectRowId(db, query.project) : null;
	if (query.project && projectId === null) return "project_not_found";
	const releases = await db.all<ReleaseRow>(
		sql`SELECT r.id, p.public_id AS project_id, r.version, r.commit_sha AS "commit", r.created_at,
				(SELECT max(id) FROM deploys WHERE release_id = r.id) AS last_deploy
			FROM releases r JOIN projects p ON p.id = r.project_id
			WHERE (${projectId} IS NULL OR r.project_id = ${projectId})
			ORDER BY last_deploy DESC, r.id DESC LIMIT ${query.limit}`,
	);
	const deploys = await db.all<ReleaseRow & { release_id: number }>({
		sql: DEPLOYS_OF_RELEASES_SQL,
		params: [JSON.stringify(releases.map((r) => r.id))],
	});
	return releases.map(({ id, last_deploy: _last, ...release }) => ({
		...release,
		deploys: deploys.filter((d) => d.release_id === id).map(({ release_id: _r, ...d }) => d),
	}));
}

/** One release: its deploys, the issues first seen in it, and the fixes it deployed or broke. */
export async function getRelease(
	db: Db,
	project: string,
	version: string,
): Promise<Record<string, unknown> | null> {
	const projectId = await findProjectRowId(db, project);
	if (projectId === null) return null;
	const release = await db.first<ReleaseRow & { id: number }>(
		sql`SELECT r.id, p.public_id AS project_id, r.version, r.commit_sha AS "commit", r.created_at
			FROM releases r JOIN projects p ON p.id = r.project_id
			WHERE r.project_id = ${projectId} AND r.version = ${version}`,
	);
	if (!release) return null;
	const deploys = await db.all({
		sql: DEPLOYS_OF_RELEASE_SQL,
		params: [release.id],
	});
	const newIssues = await db.all<{ id: number }>(
		sql`SELECT id FROM issues WHERE project_id = ${projectId} AND first_release = ${version}
				AND status != 'merged' ORDER BY id LIMIT 100`,
	);
	const fixes = await db.all(
		sql`SELECT f.issue_id, f.kind, f.ref, f.outcome FROM fixes f JOIN deploys d ON d.id = f.deploy_id
			WHERE d.release_id = ${release.id} ORDER BY f.id LIMIT 100`,
	);
	const regressed = await db.all<{ issue_id: number }>(
		sql`SELECT f.issue_id FROM fixes f JOIN issues i ON i.id = f.issue_id
			WHERE i.project_id = ${projectId} AND f.regressed_in = ${version} ORDER BY f.id LIMIT 100`,
	);
	const { id: _id, ...rest } = release;
	return {
		...rest,
		deploys,
		new_issue_ids: newIssues.map((r) => r.id),
		fixes_deployed: fixes,
		regressed_issue_ids: regressed.map((r) => r.issue_id),
	};
}

const WAITING_FIXES_SQL = `SELECT f.id FROM fixes f JOIN issues i ON i.id = f.issue_id
	WHERE f.outcome IS NULL AND f.deployed_at IS NOT NULL AND coalesce(f.quiet_since, f.deployed_at) <= ?
		AND i.status = 'fix_pending' AND ${CURRENT_FIX}
	ORDER BY f.id LIMIT ?`;
// Each statement checks the conditions again: an event can arrive between the query and the batch.
const VERIFY_ACTIVITY_SQL = `INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
	SELECT ?, 'system', NULL, 'verifier', 'issue.verify', 'issue', f.issue_id,
		json_object('from', 'fix_pending', 'to', 'verified', 'fix_id', f.id, 'quiet_hours', ?)
	FROM fixes f JOIN issues i ON i.id = f.issue_id
	WHERE f.id = ? AND f.outcome IS NULL AND coalesce(f.quiet_since, f.deployed_at) <= ?
		AND i.status = 'fix_pending'`;
const VERIFY_FIX_SQL = `UPDATE fixes AS f SET outcome = 'verified', verified_at = ?
	WHERE f.id = ? AND f.outcome IS NULL AND coalesce(f.quiet_since, f.deployed_at) <= ?
		AND (SELECT status FROM issues WHERE id = f.issue_id) = 'fix_pending'`;
const VERIFY_ISSUE_SQL = `UPDATE issues SET status = 'verified', status_changed_at = ?
	WHERE status = 'fix_pending'
		AND id = (SELECT issue_id FROM fixes WHERE id = ? AND outcome = 'verified' AND verified_at = ?)`;

/** Verifies deployed fixes whose quiet period is over. Returns the number of fixes checked. */
export async function verifyFixes(ports: P, now: Date): Promise<number> {
	const hours = ports.config.verifyQuietHours;
	const cutoff = new Date(now.getTime() - hours * 3_600_000).toISOString();
	const nowIso = now.toISOString();
	const waiting = await ports.db.all<{ id: number }>({
		sql: WAITING_FIXES_SQL,
		params: [cutoff, VERIFY_BATCH],
	});
	if (waiting.length === 0) return 0;
	await ports.db.batch(
		waiting.flatMap(({ id }) => [
			{ sql: VERIFY_ACTIVITY_SQL, params: [nowIso, hours, id, cutoff] },
			{ sql: VERIFY_FIX_SQL, params: [nowIso, id, cutoff] },
			{ sql: VERIFY_ISSUE_SQL, params: [nowIso, id, nowIso] },
			verifiedDeliveryStatement(id, nowIso),
		]),
	);
	return waiting.length;
}

/** Fix outcomes (verified, regressed), the most recent fix first. */
export async function listFixOutcomes(
	db: Db,
	query: { limit: number; since?: string | undefined },
	now: Date,
): Promise<ReleaseRow[]> {
	const since = query.since ? parseSince(query.since, now) : null;
	return db.all(
		sql`SELECT * FROM fix_outcomes
			WHERE (${since} IS NULL OR coalesce(regressed_at, verified_at) >= ${since})
			ORDER BY fix_id DESC LIMIT ${query.limit}`,
	);
}
