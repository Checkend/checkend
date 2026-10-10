import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

/**
 * Retention: the cron deletes data that is older than RETENTION_DAYS (default 90): stored events
 * and hourly counts, and pushed-commit records. Finished webhook deliveries go after 30 days.
 * Issues, the activity timeline (the audit record) and user hashes stay. Deletes run in chunks,
 * so that one run stays small in D1 row writes; the next run goes on.
 */
export const RETENTION_CHUNK = 500;
const DEFAULT_MAX_CHUNKS = 4;
const DELIVERY_DAYS = 30;

export interface RetentionRun {
	events: number;
	counts: number;
	deliveries: number;
	commits: number;
}

export async function runRetention(
	ports: Pick<Ports, "db" | "config">,
	now: Date,
	options: { maxChunks?: number } = {},
): Promise<RetentionRun> {
	const db = ports.db;
	const days = ports.config.retentionDays;
	const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
	const deliveryCutoff = new Date(now.getTime() - DELIVERY_DAYS * 86_400_000).toISOString();
	let chunks = options.maxChunks ?? DEFAULT_MAX_CHUNKS;
	const run: RetentionRun = { events: 0, counts: 0, deliveries: 0, commits: 0 };

	// Events: the oldest ids first (ids grow with time), then recount the issues they were in.
	while (chunks > 0) {
		const deleted = await db.all<{ issue_id: number }>(
			sql`DELETE FROM events WHERE id IN (
					SELECT id FROM events WHERE received_at < ${cutoff} ORDER BY id LIMIT ${RETENTION_CHUNK})
				RETURNING issue_id`,
		);
		if (deleted.length === 0) break;
		chunks--;
		run.events += deleted.length;
		const issues = JSON.stringify([...new Set(deleted.map((r) => r.issue_id))]);
		await db.run(
			sql`UPDATE issues SET stored_events = (SELECT count(*) FROM events WHERE events.issue_id = issues.id)
				WHERE id IN (SELECT value FROM json_each(${issues}))`,
		);
		if (deleted.length < RETENTION_CHUNK) break;
	}
	// Hourly counts ("YYYY-MM-DDTHH"), deliveries and pushed commits: one chunk each per step.
	const steps: [keyof RetentionRun, () => Promise<{ changes: number }>][] = [
		[
			"counts",
			() =>
				db.run(
					sql`DELETE FROM issue_counts WHERE rowid IN (
						SELECT rowid FROM issue_counts WHERE hour < ${cutoff.slice(0, 13)} LIMIT ${RETENTION_CHUNK})`,
				),
		],
		[
			"deliveries",
			() =>
				db.run(
					sql`DELETE FROM webhook_deliveries WHERE id IN (
						SELECT id FROM webhook_deliveries WHERE status != 'pending' AND created_at < ${deliveryCutoff}
						ORDER BY id LIMIT ${RETENTION_CHUNK})`,
				),
		],
		[
			"commits",
			() =>
				db.run(
					sql`DELETE FROM pushed_commits WHERE id IN (
						SELECT id FROM pushed_commits WHERE pushed_at < ${cutoff} ORDER BY id LIMIT ${RETENTION_CHUNK})`,
				),
		],
	];
	for (const [name, step] of steps) {
		while (chunks > 0) {
			const { changes } = await step();
			run[name] += changes;
			if (changes === 0) break;
			chunks--;
			if (changes < RETENTION_CHUNK) break;
		}
	}
	return run;
}
