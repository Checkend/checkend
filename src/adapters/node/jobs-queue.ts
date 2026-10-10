import type { Clock } from "../../ports/clock.ts";
import { type Db, type Statement, sql } from "../../ports/db.ts";
import { checkQueueMessage, type IngestQueue } from "../../ports/ingest-queue.ts";

/**
 * The queue of the Node runtime: rows in the jobs table (migration 0025). At least once: a
 * claimed job is locked for the visibility timeout; if the process stops, the lock ends and the
 * job runs again. A job that fails maxAttempts times is marked dead (kept for inspection).
 * jobStatement() lets a caller enqueue in the same batch (transaction) as its write.
 */
export function jobStatement(queue: string, message: object, now: Date): Statement {
	checkQueueMessage(message);
	const at = now.toISOString();
	return sql`INSERT INTO jobs (queue, body, run_after, created_at)
		VALUES (${queue}, ${JSON.stringify(message)}, ${at}, ${at})`;
}

export function sqliteJobQueue(db: Db, queue: string, clock: Clock): IngestQueue {
	return {
		async send(message) {
			await db.run(jobStatement(queue, message, clock.now()));
		},
	};
}

export interface JobItem {
	body: unknown;
	ack(): void;
	retry(): void;
}

export interface RunJobsOptions {
	batch?: number;
	visibilityMs?: number;
	maxAttempts?: number;
}

/** Waits after each failed attempt (5 s, 30 s, 2 min, 10 min, then 30 min). */
const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];

/**
 * Claims ready jobs of one queue and gives them to the handler (like a queue consumer). Each item
 * is acknowledged (deleted) or retried; an item that the handler leaves open, or a handler that
 * throws, counts as a retry. Returns the number of jobs claimed.
 */
export async function runJobs(
	db: Db,
	clock: Clock,
	queue: string,
	handler: (items: JobItem[]) => Promise<void>,
	options: RunJobsOptions = {},
): Promise<number> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const lockedUntil = new Date(now.getTime() + (options.visibilityMs ?? 60_000)).toISOString();
	const claimed = await db.all<{ id: number; body: string; attempts: number }>(
		sql`UPDATE jobs SET locked_until = ${lockedUntil}
			WHERE id IN (SELECT id FROM jobs WHERE queue = ${queue} AND status = 'ready'
				AND run_after <= ${nowIso} AND (locked_until IS NULL OR locked_until <= ${nowIso})
				ORDER BY id LIMIT ${options.batch ?? 100})
			RETURNING id, body, attempts`,
	);
	if (claimed.length === 0) return 0;
	const outcome = new Map<number, "ack" | "retry">();
	const items: JobItem[] = claimed.map((job) => ({
		body: JSON.parse(job.body) as unknown,
		ack: () => outcome.set(job.id, "ack"),
		retry: () => outcome.set(job.id, "retry"),
	}));
	let failure: string | null = null;
	try {
		await handler(items);
	} catch (error) {
		failure = String(error).slice(0, 300);
	}
	const maxAttempts = options.maxAttempts ?? 5;
	const statements: Statement[] = claimed.map((job) => {
		if (outcome.get(job.id) === "ack" && failure === null)
			return sql`DELETE FROM jobs WHERE id = ${job.id}`;
		const attempts = job.attempts + 1;
		const wait = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] as number;
		const runAfter = new Date(clock.now().getTime() + wait).toISOString();
		return sql`UPDATE jobs SET attempts = ${attempts}, locked_until = NULL, run_after = ${runAfter},
				status = ${attempts >= maxAttempts ? "dead" : "ready"}, last_error = ${failure ?? "retry"}
			WHERE id = ${job.id}`;
	});
	await db.batch(statements);
	return claimed.length;
}
