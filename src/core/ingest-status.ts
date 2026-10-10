import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { BUDGET_THRESHOLD, type IngestMode, type IngestState } from "./ingest/state.ts";

export interface IngestStatus {
	/** "counters_only": budget mode, near the D1 daily write limit (until 00:00 UTC). */
	mode: IngestMode;
	rows_written_today: number;
	daily_row_limit: number | null;
	events_received_today: number;
	write_failures_today: number;
	/** Seconds until ingest accepts events again, when D1 is overloaded; else 0. */
	retry_after_seconds: number;
}

export async function ingestStatus(
	{ db, clock, config }: Pick<Ports, "db" | "clock" | "config">,
	state: IngestState,
): Promise<IngestStatus> {
	const now = clock.now();
	const row = await db.first<{
		rows_written: number;
		events_received: number;
		write_failures: number;
	}>(
		sql`SELECT rows_written, events_received, write_failures FROM daily_usage WHERE day = ${now.toISOString().slice(0, 10)}`,
	);
	const rows = row?.rows_written ?? 0;
	const limit = config.dailyRowLimit;
	return {
		mode: limit !== null && rows >= limit * BUDGET_THRESHOLD ? "counters_only" : "full",
		rows_written_today: rows,
		daily_row_limit: limit,
		events_received_today: row?.events_received ?? 0,
		write_failures_today: row?.write_failures ?? 0,
		retry_after_seconds: state.health.snapshot(now).retryAfterSeconds,
	};
}
