import type { Ports } from "../ports/index.ts";
import type { IngestState } from "./ingest/state.ts";
import { ingestStatus } from "./ingest-status.ts";
import { type MigrationLevel, migrationLevel } from "./migrations.ts";
import { VERSION } from "./version.ts";

export interface Health {
	status: "ok" | "error";
	version: string;
	/** Null when the database cannot be read. */
	migrations: MigrationLevel | null;
	/** Null before the ingest tables exist, or when the database cannot be read. */
	ingest: {
		/** "counters_only": budget mode until 00:00 UTC (near the D1 daily write limit). */
		mode: "full" | "counters_only";
		write_failures_today: number;
		/** Ingest answers 429 for this many seconds, because D1 is overloaded. */
		retry_after_seconds: number;
	} | null;
	time: string;
}

/** The state of this install. It never includes error details: `/health` is public. */
export async function checkHealth(ports: Ports, state: IngestState): Promise<Health> {
	const time = ports.clock.now().toISOString();
	let migrations: MigrationLevel;
	try {
		migrations = await migrationLevel(ports.db);
	} catch {
		return { status: "error", version: VERSION, migrations: null, ingest: null, time };
	}
	let ingest: Health["ingest"] = null;
	try {
		const status = await ingestStatus(ports, state);
		ingest = {
			mode: status.mode,
			write_failures_today: status.write_failures_today,
			retry_after_seconds: status.retry_after_seconds,
		};
	} catch {
		// No ingest tables yet (before migration 0002).
	}
	return { status: "ok", version: VERSION, migrations, ingest, time };
}
