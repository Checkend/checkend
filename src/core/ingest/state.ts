import { type Db, sql } from "../../ports/db.ts";
import { KeyCache } from "../projects.ts";

const BACKOFF_MS = 30_000;
const SLOW_WRITE_MS = 5_000;
const FAILURES_FOR_OVERLOAD = 3;

export interface WriteHealthSnapshot {
	/** Writes that failed after all retries, in this isolate. */
	failures: number;
	/** Seconds until ingest accepts events again; 0 when it is not overloaded. */
	retryAfterSeconds: number;
}

/**
 * The state of D1 writes, as this isolate sees it (H1). After 3 failed writes in a row, or
 * one write slower than 5 s, ingest answers 429 with Retry-After for 30 s, so SDKs back off.
 */
export class WriteHealth {
	private consecutive = 0;
	private failures = 0;
	private overloadedUntil = 0;

	recordSuccess(latencyMs: number, now: Date): void {
		this.consecutive = 0;
		if (latencyMs > SLOW_WRITE_MS) this.overloadedUntil = now.getTime() + BACKOFF_MS;
	}

	recordFailure(now: Date): void {
		this.failures++;
		if (++this.consecutive >= FAILURES_FOR_OVERLOAD)
			this.overloadedUntil = now.getTime() + BACKOFF_MS;
	}

	snapshot(now: Date): WriteHealthSnapshot {
		return {
			failures: this.failures,
			retryAfterSeconds: Math.max(0, Math.ceil((this.overloadedUntil - now.getTime()) / 1000)),
		};
	}
}

export type IngestMode = "full" | "counters_only";

/** Budget threshold: budget mode starts at this share of the daily row limit. */
export const BUDGET_THRESHOLD = 0.8;

/**
 * Rows written today (estimated), cached for 30 s (H3). Near the D1 daily write limit,
 * ingest stores counters only, so that D1 does not stop all writes.
 */
export class BudgetTracker {
	private day = "";
	private rows = 0;
	private fetchedAt = 0;

	async mode(db: Db, now: Date, limit: number | null): Promise<IngestMode> {
		if (limit === null) return "full";
		const day = now.toISOString().slice(0, 10);
		if (day !== this.day || now.getTime() - this.fetchedAt > 30_000) {
			const row = await db.first<{ rows_written: number }>(
				sql`SELECT rows_written FROM daily_usage WHERE day = ${day}`,
			);
			this.day = day;
			this.rows = row?.rows_written ?? 0;
			this.fetchedAt = now.getTime();
		}
		return this.rows >= limit * BUDGET_THRESHOLD ? "counters_only" : "full";
	}

	add(now: Date, rows: number): void {
		if (now.toISOString().slice(0, 10) === this.day) this.rows += rows;
	}
}

/** Known tag keys per project, cached for 60 s. */
export class TagKeyCache {
	private entries = new Map<number, { keys: Set<string>; expires: number }>();

	async known(db: Db, projectId: number, now: Date): Promise<Set<string>> {
		const cached = this.entries.get(projectId);
		if (cached && cached.expires > now.getTime()) return cached.keys;
		const rows = await db.all<{ key: string }>(
			sql`SELECT key FROM tag_keys WHERE project_id = ${projectId}`,
		);
		const keys = new Set(rows.map((row) => row.key));
		if (this.entries.size > 1000) this.entries.clear();
		this.entries.set(projectId, { keys, expires: now.getTime() + 60_000 });
		return keys;
	}

	add(projectId: number, keys: string[]): void {
		const cached = this.entries.get(projectId);
		for (const key of keys) cached?.keys.add(key);
	}
}

/** In-memory ingest state of one isolate. The app holds one instance. */
export class IngestState {
	readonly keys = new KeyCache();
	readonly health = new WriteHealth();
	readonly budget = new BudgetTracker();
	readonly tagKeys = new TagKeyCache();
}
