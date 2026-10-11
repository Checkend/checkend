import type { Db } from "../../ports/db.ts";
import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { type Answer, clefDecisions, type Question } from "./decisions.ts";
import { issueModelInput } from "./model-input.ts";

/**
 * Stock triage of issues with Clef (AI_TRIAGE=on). The answers are advice: Checkend stores and
 * shows them (the brief), and never acts on them. Actions on issues keep their own rules
 * (REQUIRE_APPROVAL). An issue is triaged when it is seen 3 times (the scheduled run), or when an
 * agent asks for its brief.
 */
export const TRIAGE_VERSION = 1;
/** Seen this many times: worth a model call. */
export const TRIAGE_MIN_SEEN = 3;
/** Issues per scheduled run. */
const TRIAGE_PER_RUN = 20;
/** Below this confidence of Clef-flash in the category, the full Clef answers again. */
const ESCALATE_BELOW = 0.5;
/** After a failed call, the next try waits this long (each try costs a model call). */
const RETRY_AFTER_MS = 24 * 3_600_000;

export const TRIAGE_QUESTIONS: Record<string, Question> = {
	category: {
		type: "choice",
		instructions: "What is the most likely cause of this application error?",
		criteria: {
			code_bug: "A bug in the application's own code",
			dependency: "A bug or a breaking change in a third-party library or SDK",
			infrastructure: "Infrastructure: network, database, memory, disk, or a timeout",
			configuration: "Configuration: a missing or wrong setting, secret, or permission",
			user_input: "Invalid input from a user or a client that the code does not handle",
			external_service: "An external API or service that the application calls failed",
			other: "Something else",
		},
	},
	severity: {
		type: "score",
		instructions: "How severe is the impact of this error on the users of the application?",
		criteria: [
			"Cosmetic: no visible impact on users",
			"Minor: a small feature fails",
			"Major: an important feature fails for some users",
			"Critical: a core flow (sign-in, payment, data) fails or data is lost",
		],
	},
	transient: {
		type: "noul",
		instructions:
			"Is this error likely transient (a timeout, a network failure, a rate limit) and gone without a code change?",
	},
	agent_fixable: {
		type: "noul",
		instructions:
			"Can a coding agent likely fix this error with a change to the application code, from the stack trace and the source?",
	},
	noise: {
		type: "noul",
		instructions:
			"Is this error noise that a team would ignore (bots, browser extensions, old clients, expected behaviour)?",
	},
};

export interface Triage {
	model: string;
	version: number;
	answers: Record<string, Answer>;
	triaged_at: string;
}

type TriagePorts = Pick<Ports, "db" | "clock" | "config" | "models">;

/** The stored triage of an issue, or null. */
export async function getTriage(db: Db, issueId: number): Promise<Triage | null> {
	const row = await db.first<{
		model: string;
		version: number;
		answers: string;
		triaged_at: string;
	}>(
		sql`SELECT model, version, answers, triaged_at FROM issue_triage
			WHERE issue_id = ${issueId} AND answers IS NOT NULL`,
	);
	return row ? { ...row, answers: JSON.parse(row.answers) as Record<string, Answer> } : null;
}

/** Triages one issue and stores the answers. Null: AI triage is off, or no issue. */
export async function triageIssue(ports: TriagePorts, issueId: number): Promise<Triage | null> {
	if (!ports.config.ai.triage || !ports.models) return null;
	const input = await issueModelInput(ports.db, issueId);
	if (!input) return null;
	let provider = clefDecisions(ports.models, "clef-flash");
	let answers = await provider.decide(input, TRIAGE_QUESTIONS);
	const category = answers.category;
	if (category?.type === "choice" && category.confidence < ESCALATE_BELOW) {
		provider = clefDecisions(ports.models, "clef");
		answers = await provider.decide(input, TRIAGE_QUESTIONS);
	}
	const triage: Triage = {
		model: provider.model,
		version: TRIAGE_VERSION,
		answers,
		triaged_at: ports.clock.now().toISOString(),
	};
	// Idempotent: a second run (at-least-once) replaces the row.
	await ports.db.run(
		sql`INSERT INTO issue_triage (issue_id, model, version, answers, triaged_at)
			VALUES (${issueId}, ${triage.model}, ${triage.version}, ${JSON.stringify(answers)}, ${triage.triaged_at})
			ON CONFLICT (issue_id) DO UPDATE SET model = excluded.model, version = excluded.version,
				answers = excluded.answers, error = NULL, triaged_at = excluded.triaged_at`,
	);
	return triage;
}

/** Records a failed call; the stored answers (of an older version) stay. */
async function recordFailure(ports: TriagePorts, issueId: number, error: unknown): Promise<void> {
	const reason = String(error).slice(0, 300);
	const at = ports.clock.now().toISOString();
	await ports.db.run(
		sql`INSERT INTO issue_triage (issue_id, model, version, answers, error, triaged_at)
			VALUES (${issueId}, '', 0, NULL, ${reason}, ${at})
			ON CONFLICT (issue_id) DO UPDATE SET error = excluded.error, triaged_at = excluded.triaged_at`,
	);
	// Workers Logs. Checkend never reports its own errors to itself (AGENTS.md).
	console.error(
		JSON.stringify({ message: "checkend: triage failed", issue_id: issueId, error: reason }),
	);
}

/** The scheduled run: open issues seen 3 times or more, without a current triage. */
export async function runTriage(ports: TriagePorts): Promise<number> {
	if (!ports.config.ai.triage || !ports.models) return 0;
	const retryBefore = new Date(ports.clock.now().getTime() - RETRY_AFTER_MS).toISOString();
	const due = await ports.db.all<{ id: number }>(
		sql`SELECT i.id FROM issues i LEFT JOIN issue_triage t ON t.issue_id = i.id
			WHERE i.times_seen >= ${TRIAGE_MIN_SEEN} AND i.merged_into IS NULL
				AND i.status IN ('unresolved', 'regressed')
				AND (t.issue_id IS NULL OR t.version < ${TRIAGE_VERSION})
				AND (t.error IS NULL OR t.triaged_at < ${retryBefore})
			ORDER BY i.last_seen DESC LIMIT ${TRIAGE_PER_RUN}`,
	);
	let done = 0;
	for (const { id } of due) {
		try {
			if (await triageIssue(ports, id)) done++;
		} catch (error) {
			await recordFailure(ports, id, error);
		}
	}
	return done;
}

/** A brief request waits this long for the triage; then the brief comes without it. */
const BRIEF_WAIT_MS = 5000;

/**
 * Before a brief: triages the issue when it has no current triage (also below 3 events).
 * Never fails the brief: a failed or slow call is recorded, and the brief comes without triage.
 */
export async function triageForBrief(ports: TriagePorts, issueId: number): Promise<void> {
	if (!ports.config.ai.triage || !ports.models) return;
	const row = await ports.db.first<{ version: number; error: string | null; triaged_at: string }>(
		sql`SELECT version, error, triaged_at FROM issue_triage WHERE issue_id = ${issueId}`,
	);
	if (row && row.version >= TRIAGE_VERSION) return;
	const retryBefore = new Date(ports.clock.now().getTime() - RETRY_AFTER_MS).toISOString();
	if (row?.error && row.triaged_at >= retryBefore) return;
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			triageIssue(ports, issueId),
			new Promise((_, fail) => {
				timer = setTimeout(() => fail(new Error("triage timed out")), BRIEF_WAIT_MS);
			}),
		]);
	} catch (error) {
		await recordFailure(ports, issueId, error);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
