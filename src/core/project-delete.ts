import { type Statement, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import type { KeyCache } from "./projects.ts";
import type { Actor } from "./tokens.ts";

/**
^ * Project delete. The delete revokes the DSN keys, hides the project everywhere and frees
 * its slug in one batch; the cron then purges its data in chunks (runProjectPurge). There is
 * no MCP tool for it. With REQUIRE_APPROVAL=delete_project, an API token (or ADMIN_TOKEN) only
 * asks: another actor completes the delete (a human in the UI, or a second admin).
 */
export type DeleteProjectResult = "deleted" | "not_found" | "approval_required";

/** Actors whose delete waits for approval: API tokens, which agents can hold. */
const asksOnly = (actor: Actor) => actor.type === "token" || actor.type === "admin_token";

export async function deleteProject(
	ports: Pick<Ports, "db" | "clock" | "config">,
	actor: Actor,
	ref: string,
	options: { keyCache?: KeyCache } = {},
): Promise<DeleteProjectResult> {
	const { db } = ports;
	const project = await db.first<{
		id: number;
		public_id: number;
		name: string;
		slug: string;
		delete_requested_by_type: string | null;
		delete_requested_by_id: number | null;
		delete_requested_by: string | null;
	}>(
		sql`SELECT id, public_id, name, slug, delete_requested_by_type, delete_requested_by_id, delete_requested_by
			FROM projects
			WHERE (public_id = ${/^\d{10}$/.test(ref) ? Number(ref) : null} OR slug = ${ref}) AND deleted_at IS NULL`,
	);
	if (!project) return "not_found";
	const now = ports.clock.now();
	const target = { type: "project", id: project.public_id };
	if (ports.config.requireApproval.includes("delete_project") && asksOnly(actor)) {
		const requested = project.delete_requested_by_type !== null;
		const sameActor =
			project.delete_requested_by_type === actor.type &&
			project.delete_requested_by_id === actor.id &&
			project.delete_requested_by === actor.name;
		if (!requested || sameActor) {
			await db.batch([
				sql`UPDATE projects SET delete_requested_at = ${now.toISOString()}, delete_requested_by = ${actor.name},
						delete_requested_by_type = ${actor.type}, delete_requested_by_id = ${actor.id}
					WHERE id = ${project.id}`,
				activityStatement(actor, "project.delete_request", target, { name: project.name }, now),
			]);
			return "approval_required";
		}
	}
	const keys = await db.all<{ public_key: string }>(
		sql`SELECT public_key FROM project_keys WHERE project_id = ${project.id} AND revoked_at IS NULL`,
	);
	await db.batch([
		// The slug gets a suffix, so that a new app can use the name again.
		sql`UPDATE projects SET deleted_at = ${now.toISOString()},
				slug = ${`${project.slug}-deleted-${project.public_id}`}
			WHERE id = ${project.id} AND deleted_at IS NULL`,
		sql`UPDATE project_keys SET revoked_at = ${now.toISOString()}
			WHERE project_id = ${project.id} AND revoked_at IS NULL`,
		activityStatement(
			actor,
			"project.delete",
			target,
			{ name: project.name, slug: project.slug },
			now,
		),
	]);
	for (const { public_key } of keys) options.keyCache?.forget(public_key);
	return "deleted";
}

/** A deleted project is marked purged this long after the delete (the key cache TTL is 60 s). */
const PURGE_SETTLE_MS = 10 * 60_000;

/**
 * Purges the data of deleted projects, in FK order and in chunks. Each step deletes at most
 * `chunkSize` rows; a run does at most `maxChunks` steps, and the next run goes on. The project
 * row, its revoked keys and the activity stay (the audit record).
 */
export async function runProjectPurge(
	ports: Pick<Ports, "db"> & Partial<Pick<Ports, "blobs" | "vectors">>,
	now: Date,
	options: { chunkSize?: number; maxChunks?: number } = {},
): Promise<number> {
	const { db } = ports;
	const size = options.chunkSize ?? 500;
	let chunks = options.maxChunks ?? 8;
	const project = await db.first<{ id: number; deleted_at: string }>(
		sql`SELECT id, deleted_at FROM projects WHERE deleted_at IS NOT NULL AND purged_at IS NULL
			ORDER BY deleted_at LIMIT 1`,
	);
	if (!project) return 0;
	const p = project.id;
	// Each step: one statement that deletes (or updates) up to `size` rows, with its parameters.
	const steps: { run: () => Promise<number> }[] = [
		{
			run: async () => {
				const rows = await db.all<{ raw_key: string | null }>(
					sql`DELETE FROM events WHERE id IN (SELECT id FROM events WHERE project_id = ${p} LIMIT ${size})
						RETURNING raw_key`,
				);
				const keys = rows.flatMap((r) => (r.raw_key ? [r.raw_key] : []));
				if (keys.length > 0) await ports.blobs?.deleteMany(keys);
				return rows.length;
			},
		},
		simple(
			sql`DELETE FROM issue_counts WHERE rowid IN (SELECT rowid FROM issue_counts
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM issue_users WHERE rowid IN (SELECT rowid FROM issue_users
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM issue_triage WHERE issue_id IN (SELECT issue_id FROM issue_triage
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		{
			// Embeddings: the vectors in the index go with them.
			run: async () => {
				const rows = await db.all<{ issue_id: number }>(
					sql`DELETE FROM issue_embeddings WHERE issue_id IN (SELECT issue_id FROM issue_embeddings
						WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})
						RETURNING issue_id`,
				);
				if (rows.length > 0) await ports.vectors?.deleteByIds(rows.map((r) => String(r.issue_id)));
				return rows.length;
			},
		},
		simple(
			sql`DELETE FROM issue_similar WHERE rowid IN (SELECT rowid FROM issue_similar
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p})
					OR similar_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM fixes WHERE id IN (SELECT id FROM fixes
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM approvals WHERE id IN (SELECT id FROM approvals
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM webhook_deliveries WHERE id IN (SELECT id FROM webhook_deliveries
				WHERE issue_id IN (SELECT id FROM issues WHERE project_id = ${p}) LIMIT ${size})`,
		),
		{
			// Merged issues point to their target: clear the links before the issues go.
			run: async () =>
				(
					await db.run(
						sql`UPDATE issues SET merged_into = NULL WHERE id IN (
							SELECT id FROM issues WHERE project_id = ${p} AND merged_into IS NOT NULL LIMIT ${size})`,
					)
				).changes,
		},
		simple(
			sql`DELETE FROM issues WHERE id IN (SELECT id FROM issues WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM tag_keys WHERE rowid IN (SELECT rowid FROM tag_keys WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM deploy_refs WHERE rowid IN (SELECT r.rowid FROM deploy_refs r JOIN deploys d ON d.id = r.deploy_id
				WHERE d.project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM deploys WHERE id IN (SELECT id FROM deploys WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM releases WHERE id IN (SELECT id FROM releases WHERE project_id = ${p} LIMIT ${size})`,
		),
		{
			run: async () => {
				const rows = await db.all<{ blob_key: string }>(
					sql`DELETE FROM sourcemaps WHERE id IN (SELECT id FROM sourcemaps WHERE project_id = ${p} LIMIT ${size})
						RETURNING blob_key`,
				);
				if (rows.length > 0) await ports.blobs?.deleteMany(rows.map((r) => r.blob_key));
				return rows.length;
			},
		},
		simple(
			sql`DELETE FROM commits WHERE rowid IN (SELECT rowid FROM commits WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM pushed_commits WHERE rowid IN (SELECT rowid FROM pushed_commits WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM pr_merges WHERE rowid IN (SELECT rowid FROM pr_merges WHERE project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM webhook_deliveries WHERE id IN (SELECT d.id FROM webhook_deliveries d
				JOIN webhooks w ON w.id = d.webhook_id WHERE w.project_id = ${p} LIMIT ${size})`,
		),
		simple(
			sql`DELETE FROM webhooks WHERE id IN (SELECT id FROM webhooks WHERE project_id = ${p} LIMIT ${size})`,
		),
	];
	function simple(statement: Statement) {
		return { run: async () => (await db.run(statement)).changes };
	}
	let total = 0;
	for (const step of steps) {
		// A step with nothing left costs one query and no chunk of the budget.
		while (chunks > 0) {
			const n = await step.run();
			total += n;
			if (n === 0) break;
			chunks--;
			if (n < size) break;
		}
		if (chunks === 0) return total;
	}
	if (total === 0 && Date.parse(project.deleted_at) + PURGE_SETTLE_MS <= now.getTime()) {
		await db.run(sql`UPDATE projects SET purged_at = ${now.toISOString()} WHERE id = ${p}`);
	}
	return total;
}
