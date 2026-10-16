import { type Statement, sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { fixStatementsForEvent } from "../fixes.ts";
import { classifySource, type SourceClass } from "../trust.ts";
import { ingestDeliveryStatements, spikeDeliveryStatement } from "../webhooks.ts";
import { FINGERPRINT_VERSION, type IssueTitle } from "./fingerprint.ts";
import type { PreparedEvent } from "./prepare.ts";
import { type IngestMode, IngestState, SOURCE_MARK_MS } from "./state.ts";

export { IngestState };

/**
 * A compressed raw payload above this size does not go into D1 (D1 rows: 2 MB at most). With
 * blob storage it goes there (raw/<project>/<event_id>.json.gz); without, it is not kept.
 */
export const MAX_RAW_BYTES = 64 * 1024;

/** The ports of a write. Blob storage is optional: large raw payloads go there. */
type StorePorts = Pick<Ports, "db" | "clock" | "config"> & Partial<Pick<Ports, "blobs">>;

/** The raw payload of an event: in the row (small), or the key of a blob (large), or neither. */
interface RawPayload {
	inline: Uint8Array | null;
	blob: { key: string; bytes: Uint8Array } | null;
}

/** New fingerprints above the hourly cap of a project go to this one issue (a flood of new
 * fingerprints cannot fill the database). */
export const FLOOD_FINGERPRINT = "flood";
const FLOOD_TITLE: IssueTitle = {
	title: "Too many new issues: new errors above the hourly limit are grouped here",
	type: null,
	culprit: null,
};

// Estimated D1 rows written (D1 counts index updates as rows). Used for budget mode.
// Measured on D1 (test/workers/d1-rows.test.ts): a stored repeat 9-10, a repeat above the
// per-issue cap 6, a new issue 14-16. The estimate must not be below the real rows.
const ROWS_STORED = 11;
const ROWS_COUNTED = 7;
const ROWS_PER_USER = 2;
/** A new issue: the issue row and its indexes. */
const ROWS_NEW_ISSUE = 5;
/** A new tag key: its row and its index. */
const ROWS_PER_TAG_KEY = 2;
/** The seen time of a source class (the project row; no indexed column). */
const ROWS_SOURCE_MARK = 1;

/** Users stored per issue; users_affected stops at this number. */
export const MAX_USERS_PER_ISSUE = 1000;

const MAX_ATTEMPTS = 3;
// Errors that fail again on retry. Others (network, reset, overload) are retried.
const PERMANENT =
	/constraint|syntax error|no such (table|column)|datatype mismatch|too many SQL variables|parameters/i;

export interface StoreResult {
	outcome: "stored" | "counted" | "failed";
	attempts: number;
	/** Webhook deliveries that the write added (start them with startDeliveries). */
	deliveries: number;
	/** The estimated D1 rows written (for the daily budget). */
	rows: number;
}

export interface StoreOptions {
	/** Waits between attempts. Tests pass a function that does not wait. */
	sleep?: (ms: number) => Promise<void>;
	/** The event came from a browser (Origin header): the DSN of the project is public. */
	browser?: boolean;
	/** The event came from POST /v1/ingest (X-Checkend-Key): a server source. */
	native?: boolean;
	/**
	 * The DSN key of the event (lowercase). A client event marks it for good (core/trust.ts).
	 * Without it (an older queue message, a direct call), a client event marks every active key
	 * of the project (fail closed).
	 */
	key?: string;
	/**
	 * The setup test event: its issue is a test issue (resolved), and the write adds no
	 * regression, fix change, webhook delivery, hourly count or user (so no alert, count or quota).
	 */
	test?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function gzip(text: string): Promise<Uint8Array> {
	const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Writes one event in direct mode: one atomic `batch()` with the issue upsert, the event
 * insert (while the issue has fewer than N stored events), the new tag keys and the daily
 * counters. Runs inside `defer`. Retries transient failures with jitter; upserts are
 * idempotent per event_id, so a retry does not count an event twice.
 */
export async function storeEvent(
	ports: StorePorts,
	state: IngestState,
	projectId: number,
	prepared: PreparedEvent,
	options: StoreOptions = {},
): Promise<StoreResult> {
	return storeEvents(
		ports,
		state,
		projectId,
		[
			{
				prepared,
				browser: options.browser ?? false,
				native: options.native ?? false,
				...(options.key === undefined ? {} : { key: options.key }),
			},
		],
		options,
	);
}

/**
 * Writes several events of one project in one atomic `batch()` (the queue consumer groups
 * events by fingerprint). The statements of each event are the same as in storeEvent, in order,
 * so the sampling and the duplicate checks work across the group.
 */
export async function storeEvents(
	ports: StorePorts,
	state: IngestState,
	projectId: number,
	items: { prepared: PreparedEvent; browser: boolean; native?: boolean; key?: string }[],
	options: StoreOptions = {},
): Promise<StoreResult> {
	const sleep = options.sleep ?? defaultSleep;
	const raws = await Promise.all(
		items.map(async ({ prepared }): Promise<RawPayload> => {
			const compressed = prepared.rawJson === null ? null : await gzip(prepared.rawJson);
			if (!compressed) return { inline: null, blob: null };
			if (compressed.byteLength <= MAX_RAW_BYTES) return { inline: compressed, blob: null };
			if (!ports.blobs) return { inline: null, blob: null };
			const key = `raw/${projectId}/${prepared.event.event_id}.json.gz`;
			return { inline: null, blob: { key, bytes: compressed } };
		}),
	);

	let lastError: unknown;
	let attempt = 0;
	while (attempt < MAX_ATTEMPTS) {
		attempt++;
		const started = Date.now();
		try {
			const statements: Statement[] = [];
			const deliveryStatements: number[] = [];
			let rows = 0;
			let stored = false;
			const newTagKeys: string[] = [];
			const sourceMarks: SourceClass[] = [];
			const keyMarks: string[] = [];
			const blobs: { key: string; bytes: Uint8Array }[] = [];
			for (const [i, item] of items.entries()) {
				const raw = raws[i] ?? { inline: null, blob: null };
				const write = await planWrite(
					ports,
					state,
					projectId,
					item.prepared,
					raw,
					item.prepared.payloadBytes,
					{
						...options,
						browser: item.browser,
						native: item.native ?? false,
						...(item.key === undefined ? {} : { key: item.key }),
					},
				);
				// The blob goes first: the row that names it is written after it.
				if (write.mode === "full" && raw.blob) blobs.push(raw.blob);
				deliveryStatements.push(...write.deliveryStatements.map((at) => at + statements.length));
				statements.push(...write.statements);
				rows += write.rows;
				stored ||= write.mode === "full";
				newTagKeys.push(...write.newTagKeys);
				if (write.sourceMark) sourceMarks.push(write.sourceMark);
				if (write.keyMark) keyMarks.push(write.keyMark);
			}
			await Promise.all(blobs.map((blob) => ports.blobs?.put(blob.key, blob.bytes)));
			const results = await ports.db.batch(statements);
			const deliveries = deliveryStatements.reduce(
				(sum, at) => sum + (results[at]?.rows.length ?? 0),
				0,
			);
			const now = ports.clock.now();
			state.health.recordSuccess(Date.now() - started, now);
			state.budget.add(now, rows);
			state.tagKeys.add(projectId, newTagKeys);
			for (const source of sourceMarks) state.sources.mark(projectId, source, now);
			for (const key of keyMarks) state.sources.markKey(projectId, key);
			return { outcome: stored ? "stored" : "counted", attempts: attempt, deliveries, rows };
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
			event_ids: items.map((item) => item.prepared.event.event_id).slice(0, 10),
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
	return { outcome: "failed", attempts: attempt, deliveries: 0, rows: 0 };
}

interface PlannedWrite {
	mode: IngestMode;
	statements: Statement[];
	rows: number;
	newTagKeys: string[];
	/** Indexes of the statements that add webhook deliveries (RETURNING id). */
	deliveryStatements: number[];
	/** The source class whose seen time the write sets, if any. */
	sourceMark: SourceClass | null;
	/** The DSN key that the write marks as client, if any (null also when all keys are marked). */
	keyMark: string | null;
}

async function planWrite(
	{ db, clock, config }: Pick<Ports, "db" | "clock" | "config">,
	state: IngestState,
	projectId: number,
	prepared: PreparedEvent,
	raw: RawPayload,
	rawBytes: number,
	options: StoreOptions,
): Promise<PlannedWrite> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const { event } = prepared;
	const mode = await state.budget.mode(db, now, config.dailyRowLimit);

	// New-issue cap per project per hour.
	let fingerprint = prepared.fingerprint.hash;
	let title = prepared.title;
	let existing = await db.first<{ id: number; merged_into: number | null }>(
		sql`SELECT id, merged_into FROM issues WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}`,
	);
	// A merged issue sends its events to the issue it was merged into (a few hops at most).
	for (let hop = 0; existing?.merged_into && hop < 5; hop++) {
		const target = await db.first<{ id: number; merged_into: number | null; fingerprint: string }>(
			sql`SELECT id, merged_into, fingerprint FROM issues WHERE id = ${existing.merged_into}`,
		);
		if (!target) break;
		existing = target;
		fingerprint = target.fingerprint;
	}
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

	const statements: Statement[] = [];
	// The source class of the event sets the trust of the project (core/trust.ts). First in the
	// batch: the webhook deliveries below must see the new trust. At most once an hour per class;
	// a retry or a second isolate writes nothing more (idempotent).
	const runtime = (event.contexts?.runtime as { name?: unknown } | undefined)?.name;
	const source = classifySource(event.sdk?.name ?? null, {
		origin: options.browser === true,
		native: options.native === true,
		platform: event.platform,
		runtime: typeof runtime === "string" ? runtime : null,
	});
	const sourceMark = state.sources.due(projectId, source, now) ? source : null;
	if (sourceMark) {
		const markedBefore = new Date(now.getTime() - SOURCE_MARK_MS).toISOString();
		statements.push(
			sourceMark === "server"
				? sql`UPDATE projects SET server_seen_at = ${nowIso}
					WHERE id = ${projectId} AND (server_seen_at IS NULL OR server_seen_at <= ${markedBefore})`
				: sql`UPDATE projects SET client_seen_at = ${nowIso}
					WHERE id = ${projectId} AND (client_seen_at IS NULL OR client_seen_at <= ${markedBefore})`,
		);
	}
	const test = options.test === true;
	// A client event marks its DSN key for good: the key is public, so the app stays low trust
	// until the key is rotated or an admin sets the trust (core/trust.ts). Once per key (the
	// statement writes nothing for a marked key). Not for the setup test event: Checkend makes
	// it, no DSN key sends it.
	let keyMark: string | null = null;
	let keyRows = 0;
	if (source === "client" && !test) {
		if (options.key === undefined) {
			statements.push(
				sql`UPDATE project_keys SET client_marked_at = ${nowIso}
					WHERE project_id = ${projectId} AND revoked_at IS NULL AND client_marked_at IS NULL`,
			);
			keyRows = ROWS_SOURCE_MARK;
		} else if (state.sources.keyDue(projectId, options.key)) {
			statements.push(
				sql`UPDATE project_keys SET client_marked_at = ${nowIso}
					WHERE project_id = ${projectId} AND public_key = ${options.key} AND client_marked_at IS NULL`,
			);
			keyMark = options.key;
			keyRows = ROWS_SOURCE_MARK;
		}
	}
	if (!test) {
		statements.push(
			// A new event reopens a resolved issue (a regression). Not for an event_id that is stored.
			sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${nowIso}, 'system', NULL, 'ingest', 'issue.regress', 'issue', id,
				${JSON.stringify({ from: "resolved", to: "unresolved", event_id: event.event_id })}
			FROM issues
			WHERE project_id = ${projectId} AND fingerprint = ${fingerprint} AND status = 'resolved' AND test = 0
				AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})`,
		);
	}
	statements.push(
		sql`INSERT INTO issues (project_id, fingerprint, fingerprint_version, title, culprit, type,
				level, platform, first_seen, last_seen, first_release, last_release, times_seen, test, status)
			SELECT ${projectId}, ${fingerprint}, ${FINGERPRINT_VERSION}, ${title.title}, ${title.culprit},
				${title.type}, ${event.level}, ${event.platform}, ${nowIso}, ${nowIso}, ${event.release},
				${event.release}, 1, ${test ? 1 : 0}, ${test ? "resolved" : "unresolved"}
			WHERE NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})
			ON CONFLICT (project_id, fingerprint) DO UPDATE SET
				times_seen = times_seen + 1,
				last_seen = max(last_seen, excluded.last_seen),
				last_release = coalesce(excluded.last_release, last_release),
				status_changed_at = CASE WHEN status = 'resolved' AND test = 0 THEN excluded.last_seen ELSE status_changed_at END,
				status = CASE WHEN status = 'resolved' AND test = 0 THEN 'unresolved' ELSE status END,
				level = excluded.level`,
	);

	const deliveryStatements: number[] = [];
	if (!test) {
		// The fix loop: regressed (an event in a release with the fix), or the quiet period again.
		statements.push(
			...fixStatementsForEvent(projectId, fingerprint, event.event_id, event.release, nowIso),
		);

		// Webhook deliveries for a new issue or a regression (after the upsert and the regression).
		const deliveries = ingestDeliveryStatements(projectId, fingerprint, event.event_id, nowIso);
		deliveryStatements.push(statements.length, statements.length + 1);
		statements.push(deliveries.newIssue, deliveries.regressed);

		// Hourly count and users affected. Before the event insert: the duplicate check looks for
		// the event_id in events, and the insert below adds it.
		statements.push(
			sql`INSERT INTO issue_counts (issue_id, hour, count)
				SELECT id, ${nowIso.slice(0, 13)}, 1 FROM issues
				WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}
					AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})
				ON CONFLICT (issue_id, hour) DO UPDATE SET count = count + 1`,
		);
		// The minute count of the project, for the Live chart (the same duplicate check).
		statements.push(
			sql`INSERT INTO minute_counts (project_id, minute, count)
				SELECT ${projectId}, ${nowIso.slice(0, 16)}, 1
				WHERE NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})
				ON CONFLICT (project_id, minute) DO UPDATE SET count = count + 1`,
		);
		// Spike alerts: after the count, before the event insert (the duplicate check).
		deliveryStatements.push(statements.length);
		statements.push(spikeDeliveryStatement(projectId, fingerprint, event.event_id, nowIso));
		if (prepared.userHash) {
			statements.push(
				sql`INSERT INTO issue_users (issue_id, user_hash, first_seen)
					SELECT id, ${prepared.userHash}, ${nowIso} FROM issues
					WHERE project_id = ${projectId} AND fingerprint = ${fingerprint} AND users_affected < ${MAX_USERS_PER_ISSUE}
						AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ${projectId} AND event_id = ${event.event_id})
					ON CONFLICT (issue_id, user_hash) DO NOTHING`,
				sql`UPDATE issues SET users_affected = (SELECT COUNT(*) FROM issue_users WHERE issue_users.issue_id = issues.id)
					WHERE project_id = ${projectId} AND fingerprint = ${fingerprint}`,
			);
		}
	}

	if (mode === "full") {
		const data = JSON.stringify({ ...event, tags });
		statements.push(
			sql`INSERT INTO events (project_id, issue_id, event_id, timestamp, received_at, level,
					release, environment, data, raw, raw_key, raw_size)
				SELECT ${projectId}, id, ${event.event_id}, ${event.timestamp}, ${nowIso}, ${event.level},
					${event.release}, ${event.environment}, ${data}, ${raw.inline}, ${raw.blob?.key ?? null}, ${rawBytes}
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

	const rows =
		(mode === "full" ? ROWS_STORED : ROWS_COUNTED) +
		(existing ? 0 : ROWS_NEW_ISSUE) +
		newTagKeys.length * ROWS_PER_TAG_KEY +
		(prepared.userHash ? ROWS_PER_USER : 0) +
		(sourceMark ? ROWS_SOURCE_MARK : 0) +
		keyRows;
	const day = nowIso.slice(0, 10);
	statements.push(
		sql`INSERT INTO daily_usage (day, events_received, events_stored, rows_written)
			VALUES (${day}, 1, ${mode === "full" ? 1 : 0}, ${rows})
			ON CONFLICT (day) DO UPDATE SET
				events_received = events_received + 1,
				events_stored = events_stored + excluded.events_stored,
				rows_written = rows_written + excluded.rows_written`,
	);
	return { mode, statements, rows, newTagKeys, deliveryStatements, sourceMark, keyMark };
}
