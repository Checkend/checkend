import { type Statement, sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { FINGERPRINT_VERSION, type IssueTitle } from "./fingerprint.ts";
import type { PreparedEvent } from "./prepare.ts";
import { type IngestMode, IngestState } from "./state.ts";

export { IngestState };

/** A compressed raw payload above this size is not stored (D1 rows: 2 MB at most). */
export const MAX_RAW_BYTES = 64 * 1024;

/** New fingerprints above the hourly cap of a project go to this one issue (H2 layer 3). */
export const FLOOD_FINGERPRINT = "flood";
const FLOOD_TITLE: IssueTitle = {
	title: "Too many new issues: new errors above the hourly limit are grouped here",
	type: null,
	culprit: null,
};

// Estimated D1 rows written (D1 counts index updates as rows). Used for budget mode.
const ROWS_STORED = 8;
const ROWS_COUNTED = 4;

const MAX_ATTEMPTS = 3;
// Errors that fail again on retry. Others (network, reset, overload) are retried.
const PERMANENT =
	/constraint|syntax error|no such (table|column)|datatype mismatch|too many SQL variables|parameters/i;

export interface StoreResult {
	outcome: "stored" | "counted" | "failed";
	attempts: number;
}

export interface StoreOptions {
	/** Waits between attempts. Tests pass a function that does not wait. */
	sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Writes one event in direct mode: one atomic `batch()` with the issue upsert, the event
 * insert (while the issue has fewer than N stored events), the new tag keys and the daily
 * counters. Runs inside `defer`. Retries transient failures with jitter (H1); upserts are
 * idempotent per event_id, so a retry does not count an event twice.
 */
export async function storeEvent(
	ports: Pick<Ports, "db" | "clock" | "config">,
	state: IngestState,
	projectId: number,
	prepared: PreparedEvent,
	options: StoreOptions = {},
): Promise<StoreResult> {
	const sleep = options.sleep ?? defaultSleep;
	const rawBytes = prepared.payloadBytes;
	const compressed = prepared.rawJson === null ? null : await gzip(prepared.rawJson);
	const raw = compressed && compressed.byteLength <= MAX_RAW_BYTES ? compressed : null;

	let lastError: unknown;
	let attempt = 0;
	while (attempt < MAX_ATTEMPTS) {
		attempt++;
		const started = Date.now();
		try {
			const write = await planWrite(ports, state, projectId, prepared, raw, rawBytes);
			await ports.db.batch(write.statements);
			const now = ports.clock.now();
			state.health.recordSuccess(Date.now() - started, now);
			state.budget.add(now, write.rows);
			state.tagKeys.add(projectId, write.newTagKeys);
			return { outcome: write.mode === "full" ? "stored" : "counted", attempts: attempt };
		} catch (error) {
			lastError = error;
			if (PERMANENT.test(String(error)) || attempt === MAX_ATTEMPTS) break;
			await sleep(50 * 2 ** attempt * (0.5 + Math.random()));
		}
	}

	const now = ports.clock.now();
	state.health.recordFailure(now);
	// Workers Logs. Checkend never reports its own errors to itself (AGENTS.md).
	console.error(
		JSON.stringify({
			message: "checkend: ingest write failed",
			project_id: projectId,
			event_id: prepared.event.event_id,
			attempts: attempt,
			error: String(lastError).slice(0, 300),
		}),
	);
	try {
		const day = now.toISOString().slice(0, 10);
		await ports.db.run(
			sql`INSERT INTO daily_usage (day, write_failures) VALUES (${day}, ${1})
				ON CONFLICT (day) DO UPDATE SET write_failures = write_failures + 1`,
		);
	} catch {
		// D1 is down; the in-memory counter in /health still has the failure.
	}
	return { outcome: "failed", attempts: attempt };
}

interface PlannedWrite {
	mode: IngestMode;
	statements: Statement[];
	rows: number;
	newTagKeys: string[];
}

async function planWrite(
	{ db, clock, config }: Pick<Ports, "db" | "clock" | "config">,
	state: IngestState,
	projectId: number,
	prepared: PreparedEvent,
	raw: Uint8Array | null,
	rawBytes: number,
): Promise<PlannedWrite> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const { event } = prepared;
	const mode = await state.budget.mode(db, now, config.dailyRowLimit);

	// New-issue cap per project per hour.
	let fingerprint = prepared.fingerprint.hash;
	let title = prepared.title;
	const existing = await db.first(
		sql`SELECT id FROM issues WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}`,
	);
	if (!existing) {
		const since = new Date(now.getTime() - 3600_000).toISOString();
		const recent = await db.first<{ n: number }>(
			sql`SELECT COUNT(*) AS n FROM issues
				WHERE project_id = ${projectId} AND first_seen >= ${since} AND fingerprint != ${FLOOD_FINGERPRINT}`,
		);
		if ((recent?.n ?? 0) >= config.newIssuesPerHour) {
			fingerprint = FLOOD_FINGERPRINT;
			title = FLOOD_TITLE;
		}
	}

	// Tag-key cap per project: known keys are kept; new keys only while there is room.
	const known = await state.tagKeys.known(db, projectId, now);
	const newTagKeys: string[] = [];
	const tags = event.tags.filter(([key]) => {
		if (known.has(key) || newTagKeys.includes(key)) return true;
		if (known.size + newTagKeys.length >= config.tagKeysPerProject) return false;
		newTagKeys.push(key);
		return true;
	});

	const statements: Statement[] = [
		sql`INSERT INTO issues (project_id, fingerprint, fingerprint_version, title, culprit, type,
				level, platform, first_seen, last_seen, first_release, last_release, times_seen)
			SELECT ${projectId}, ${fingerprint}, ${FINGERPRINT_VERSION}, ${title.title}, ${title.culprit},
				${title.type}, ${event.level}, ${event.platform}, ${nowIso}, ${nowIso}, ${event.release},
				${event.release}, 1
			WHERE NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})
			ON CONFLICT (project_id, fingerprint) DO UPDATE SET
				times_seen = times_seen + 1,
				last_seen = max(last_seen, excluded.last_seen),
				last_release = coalesce(excluded.last_release, last_release),
				level = excluded.level`,
	];

	if (mode === "full") {
		const data = JSON.stringify({ ...event, tags });
		statements.push(
			sql`INSERT INTO events (project_id, issue_id, event_id, timestamp, received_at, level,
					release, environment, data, raw, raw_size)
				SELECT ${projectId}, id, ${event.event_id}, ${event.timestamp}, ${nowIso}, ${event.level},
					${event.release}, ${event.environment}, ${data}, ${raw}, ${rawBytes}
				FROM issues
				WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}
					AND stored_events < ${config.eventsPerIssue}
				ON CONFLICT (project_id, event_id) DO NOTHING`,
			sql`UPDATE issues SET stored_events = (SELECT COUNT(*) FROM events WHERE events.issue_id = issues.id)
				WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}`,
		);
	}

	for (const key of newTagKeys) {
		statements.push(
			sql`INSERT INTO tag_keys (project_id, key, created_at) VALUES (${projectId}, ${key}, ${nowIso})
				ON CONFLICT (project_id, key) DO NOTHING`,
		);
	}

	const rows = (mode === "full" ? ROWS_STORED : ROWS_COUNTED) + newTagKeys.length;
	const day = nowIso.slice(0, 10);
	statements.push(
		sql`INSERT INTO daily_usage (day, events_received, events_stored, rows_written)
			VALUES (${day}, 1, ${mode === "full" ? 1 : 0}, ${rows})
			ON CONFLICT (day) DO UPDATE SET
				events_received = events_received + 1,
				events_stored = events_stored + excluded.events_stored,
				rows_written = rows_written + excluded.rows_written`,
	);
	return { mode, statements, rows, newTagKeys };
}
