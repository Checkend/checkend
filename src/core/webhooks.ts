import * as v from "valibot";
import { type Db, type Statement, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { isEmailAddress } from "../ports/mailer.ts";
import { activityStatement } from "./activity.ts";
import {
	type AlertContent,
	discordMessage,
	emailMessage,
	githubIssue,
	slackMessage,
} from "./alert-format.ts";
import { buildBrief } from "./brief.ts";
import { decryptValue, encryptValue, keyIdOf } from "./crypto.ts";
import { formatIssueId } from "./ids.ts";
import { findProjectRowId, getIssue, ProjectRef } from "./issues.ts";
import { checkOutboundUrl } from "./outbound.ts";
import type { Actor } from "./tokens.ts";
import { EFFECTIVE_TRUST_SQL } from "./trust.ts";
import { VERSION } from "./version.ts";

/**
 * Outgoing webhooks: Checkend tells another system (for example an agent runner) about an
 * issue, with its brief. Events: issue.new, issue.regressed, issue.verified. A delivery row is
 * written in the same batch as the change; then the notify queue (or `defer`) sends it, and the
 * cron retries it with a backoff. Each body is signed:
 *   X-Checkend-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>
 * A webhook gets only issues of projects at or above its min_trust (default high): text from a
 * public browser DSN does not start agent runs unless an admin allows it.
 */
export const WEBHOOK_EVENTS = [
	"issue.new",
	"issue.regressed",
	"issue.verified",
	"issue.spike",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "ping";

/**
 * Formats: "checkend" (the Checkend body, for your own receiver), or "github_dispatch" (a
 * GitHub repository_dispatch, so that a GitHub Actions workflow starts an agent; needs
 * github_token, a token that can only create dispatches for that repository).
 */
export const WEBHOOK_FORMATS = [
	"checkend",
	"github_dispatch",
	"slack",
	"discord",
	"github_issue",
	"email",
] as const;
type Format = (typeof WEBHOOK_FORMATS)[number];

/** URLs per format. Slack and Discord URLs are secrets: stored encrypted, shown masked. */
const FORMAT_URLS: Partial<Record<Format, { pattern: RegExp; example: string; secret: boolean }>> =
	{
		github_dispatch: {
			pattern:
				/^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\/dispatches$/,
			example: "https://api.github.com/repos/<owner>/<repo>/dispatches",
			secret: false,
		},
		github_issue: {
			pattern:
				/^https:\/\/api\.github\.com\/repos\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\/issues$/,
			example: "https://api.github.com/repos/<owner>/<repo>/issues",
			secret: false,
		},
		slack: {
			pattern:
				/^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9]{1,40}\/[A-Za-z0-9]{1,40}\/[A-Za-z0-9]{1,80}$/,
			example: "https://hooks.slack.com/services/<...>",
			secret: true,
		},
		discord: {
			pattern:
				/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d{1,30}\/[A-Za-z0-9_-]{1,100}$/,
			example: "https://discord.com/api/webhooks/<id>/<token>",
			secret: true,
		},
	};
const TOKEN_FORMATS: Format[] = ["github_dispatch", "github_issue"];

/** A secret URL as the API shows it: the path up to the first secret part. */
const maskUrl = (url: string, format: Format) => {
	const parts = url.split("/");
	return format === "slack"
		? `${parts.slice(0, 5).join("/")}/…`
		: `${parts.slice(0, 6).join("/")}/…`;
};

export const CreateWebhookBody = v.strictObject({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	/** Every format except email. */
	url: v.optional(v.pipe(v.string(), v.maxLength(2000))),
	format: v.optional(v.picklist(WEBHOOK_FORMATS), "checkend"),
	/** email only: the recipients. */
	to: v.optional(
		v.pipe(v.array(v.pipe(v.string(), v.maxLength(320))), v.minLength(1), v.maxLength(20)),
	),
	/** With the event issue.spike: alert when the events of an issue in this hour go above it. */
	spike_threshold: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000)),
	),
	/** github_dispatch only: the token for the GitHub API (stored encrypted). */
	github_token: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
	events: v.pipe(v.array(v.picklist(WEBHOOK_EVENTS)), v.minLength(1), v.maxLength(10)),
	min_trust: v.optional(v.picklist(["low", "high"]), "high"),
	/** Only issues of this project; default: all projects. */
	project: v.optional(ProjectRef),
});
export type CreateWebhookBody = v.InferOutput<typeof CreateWebhookBody>;

/** Attempts per delivery, and the wait after each failed attempt. */
export const MAX_ATTEMPTS = 8;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360, 720, 1440];
/** Deliveries per run (a run is in waitUntil, a queue message or the cron). */
const DELIVERIES_PER_RUN = 10;
const LOCK_SECONDS = 60;
const TIMEOUT_MS = 10_000;

type P = Ports;

const secretContext = (uid: string) => `webhooks.secret:${uid}`;
const authContext = (uid: string) => `webhooks.auth:${uid}`;

const toBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export type CreateResult =
	| { kind: "done"; webhook: Record<string, unknown> }
	| { kind: "invalid"; path: string; message: string }
	| { kind: "encryption_not_configured" }
	| { kind: "email_not_configured" };

export async function createWebhook(
	ports: P,
	actor: Actor,
	body: CreateWebhookBody,
): Promise<CreateResult> {
	if (ports.config.encryptionKeys.length === 0) return { kind: "encryption_not_configured" };
	const invalid = (path: string, message: string): CreateResult => ({
		kind: "invalid",
		path,
		message,
	});
	const format = body.format;
	const email = format === "email";
	if (email) {
		if (!ports.mailer) return { kind: "email_not_configured" };
		if (body.url !== undefined) return invalid("url", "The email format has no url; use to.");
		if (!body.to) return invalid("to", "The email format needs to (the recipients).");
		const bad = body.to.find((address) => !isEmailAddress(address));
		if (bad !== undefined) return invalid("to", "Not a valid email address.");
	} else {
		if (body.to !== undefined) return invalid("to", "to is only for the email format.");
		if (body.url === undefined) return invalid("url", "url is required.");
	}
	const rule = FORMAT_URLS[format];
	if (rule && !rule.pattern.test(body.url ?? "")) {
		return invalid("url", `A ${format} URL is ${rule.example}.`);
	}
	if (TOKEN_FORMATS.includes(format) !== (body.github_token !== undefined)) {
		return invalid(
			"github_token",
			"github_token is required for the github_dispatch and github_issue formats, and only for them.",
		);
	}
	if (body.events.includes("issue.spike") !== (body.spike_threshold !== undefined)) {
		return invalid(
			"spike_threshold",
			"spike_threshold is required with the event issue.spike, and only with it.",
		);
	}
	if (body.url !== undefined) {
		const check = await checkOutboundUrl(body.url, ports.resolver);
		if (!check.ok) return invalid("url", check.reason);
	}
	const projectId = body.project ? await findProjectRowId(ports.db, body.project) : null;
	if (body.project && projectId === null) {
		return { kind: "invalid", path: "project", message: "No such project." };
	}
	const uid = crypto.randomUUID();
	const secret = `whsec_${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
	const encrypted = await encryptValue(ports.config.encryptionKeys, secret, secretContext(uid));
	// The encrypted extra: a GitHub token, or the secret URL of Slack and Discord.
	const authValue = body.github_token ?? (rule?.secret ? body.url : undefined);
	const auth = authValue
		? await encryptValue(ports.config.encryptionKeys, authValue, authContext(uid))
		: null;
	const shownUrl =
		body.url === undefined ? null : rule?.secret ? maskUrl(body.url, format) : body.url;
	const recipients = body.to
		? JSON.stringify([...new Set(body.to.map((a) => a.toLowerCase()))])
		: null;
	const now = ports.clock.now();
	const events = JSON.stringify([...new Set(body.events)]);
	const [inserted] = await ports.db.batch([
		sql`INSERT INTO webhooks (uid, name, url, format, secret, auth, events, min_trust, project_id,
				created_at, created_by, recipients, spike_threshold)
			VALUES (${uid}, ${body.name}, ${shownUrl ?? ""}, ${format}, ${encrypted}, ${auth}, ${events},
				${body.min_trust}, ${projectId}, ${now.toISOString()}, ${actor.name}, ${recipients},
				${body.spike_threshold ?? null})
			RETURNING id`,
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${now.toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, 'webhook.create', 'webhook', id,
				json_object('name', ${body.name}, 'format', ${format}, 'url', ${shownUrl})
			FROM webhooks WHERE uid = ${uid}`,
	]);
	const id = Number(inserted?.rows[0]?.id);
	const [webhook] = (await listWebhooks(ports.db)).filter((w) => w.id === id);
	return { kind: "done", webhook: { ...webhook, secret } };
}

const WEBHOOK_COLUMNS = `w.id, w.name, w.url, w.format, w.events, w.min_trust, p.public_id AS project_id,
	w.recipients, w.spike_threshold, w.created_at, w.created_by,
	(SELECT status FROM webhook_deliveries WHERE webhook_id = w.id ORDER BY id DESC LIMIT 1) AS last_delivery_status`;
const LIST_WEBHOOKS_SQL = `SELECT ${WEBHOOK_COLUMNS}
	FROM webhooks w LEFT JOIN projects p ON p.id = w.project_id
	WHERE w.deleted_at IS NULL ORDER BY w.id`;

export async function listWebhooks(db: Db): Promise<Record<string, unknown>[]> {
	const rows = await db.all<{ id: number; events: string; url: string; recipients: string | null }>(
		{
			sql: LIST_WEBHOOKS_SQL,
			params: [],
		},
	);
	return rows.map(({ recipients, ...row }) => ({
		...row,
		url: row.url === "" ? null : row.url,
		events: JSON.parse(row.events),
		...(recipients ? { to: JSON.parse(recipients) as string[] } : {}),
	}));
}

/**
 * Alert rules for readers (issues:read): no secrets, no email addresses, and URLs without their
 * query string (a query can hold a token).
 */
export async function listAlerts(db: Db): Promise<Record<string, unknown>[]> {
	return (await listWebhooks(db)).map(({ to, url, created_by: _by, ...rule }) => ({
		...rule,
		url: typeof url === "string" ? url.split(/[?#]/)[0] : null,
		recipients: Array.isArray(to) ? to.length : null,
	}));
}

export async function deleteWebhook(ports: P, actor: Actor, id: number): Promise<boolean> {
	const found = await ports.db.first(
		sql`SELECT id FROM webhooks WHERE id = ${id} AND deleted_at IS NULL`,
	);
	if (!found) return false;
	const now = ports.clock.now();
	await ports.db.batch([
		sql`UPDATE webhooks SET deleted_at = ${now.toISOString()} WHERE id = ${id}`,
		activityStatement(actor, "webhook.delete", { type: "webhook", id }, undefined, now),
	]);
	return true;
}

export async function listDeliveries(db: Db, webhookId: number, limit: number) {
	return db.all(
		sql`SELECT id, event, issue_id, status, attempts, last_status, last_error, created_at,
				next_attempt_at, delivered_at
			FROM webhook_deliveries WHERE webhook_id = ${webhookId} ORDER BY id DESC LIMIT ${limit}`,
	);
}

/** A test delivery (event ping). Returns its ID, or null when there is no such webhook. */
export async function pingWebhook(ports: P, id: number): Promise<number | null> {
	const nowIso = ports.clock.now().toISOString();
	const row = await ports.db.first<{ id: number }>(
		sql`INSERT INTO webhook_deliveries (webhook_id, event, issue_id, next_attempt_at, created_at)
			SELECT id, 'ping', NULL, ${nowIso}, ${nowIso} FROM webhooks WHERE id = ${id} AND deleted_at IS NULL
			RETURNING id`,
	);
	return row?.id ?? null;
}

// The trust of a project now (core/trust.ts). It has no parameters.
const PROJECT_TRUST = EFFECTIVE_TRUST_SQL("p");

/**
 * Inserts deliveries of `event` for the issues that `issueCondition` selects (alias i), to each
 * webhook that wants the event, the project and the trust. Parameters: event, now, now, then
 * the parameters of the condition, then the event again.
 */
const enqueueSql = (issueCondition: string) => `INSERT INTO webhook_deliveries
		(webhook_id, event, issue_id, next_attempt_at, created_at)
	SELECT w.id, ?, i.id, ?, ? FROM issues i
	JOIN projects p ON p.id = i.project_id
	JOIN webhooks w ON w.deleted_at IS NULL AND (w.project_id IS NULL OR w.project_id = i.project_id)
	WHERE ${issueCondition}
		AND EXISTS (SELECT 1 FROM json_each(w.events) WHERE value = ?)
		AND (w.min_trust = 'low' OR ${PROJECT_TRUST} = 'high')
	RETURNING id`;

// Ingest. A new issue: created in this batch (first event now), and not a duplicate event.
const NEW_ISSUE_SQL = enqueueSql(`i.project_id = ? AND i.fingerprint = ? AND i.times_seen = 1
	AND i.first_seen = ? AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ? AND event_id = ?)`);
// A regression in this batch: an issue.regress activity row of ingest, now.
const REGRESSED_SQL = enqueueSql(`i.project_id = ? AND i.fingerprint = ?
	AND EXISTS (SELECT 1 FROM activity a WHERE a.target_type = 'issue' AND a.target_id = i.id
		AND a.action = 'issue.regress' AND a.actor_name = 'ingest' AND a.at = ?)`);
// The fix of the issue was verified now.
const VERIFIED_SQL = enqueueSql(`i.status = 'verified'
	AND i.id = (SELECT issue_id FROM fixes WHERE id = ? AND outcome = 'verified' AND verified_at = ?)`);

/** Delivery statements for the ingest batch: after the issue upsert, before the event insert. */
export function ingestDeliveryStatements(
	projectId: number,
	fingerprint: string,
	eventId: string,
	nowIso: string,
): { newIssue: Statement; regressed: Statement } {
	return {
		newIssue: {
			sql: NEW_ISSUE_SQL,
			params: [
				"issue.new",
				nowIso,
				nowIso,
				projectId,
				fingerprint,
				nowIso,
				projectId,
				eventId,
				"issue.new",
			],
		},
		regressed: {
			sql: REGRESSED_SQL,
			params: [
				"issue.regressed",
				nowIso,
				nowIso,
				projectId,
				fingerprint,
				nowIso,
				"issue.regressed",
			],
		},
	};
}

// A spike: the hourly count of the issue just went from the threshold to threshold + 1, so the
// alert fires once per issue and hour. Not for a duplicate event (the count did not change).
const SPIKE_SQL = `INSERT INTO webhook_deliveries
		(webhook_id, event, issue_id, next_attempt_at, created_at, data)
	SELECT w.id, 'issue.spike', i.id, ?, ?, json_object('events_1h', c.count, 'threshold', w.spike_threshold)
	FROM issues i
	JOIN projects p ON p.id = i.project_id
	JOIN issue_counts c ON c.issue_id = i.id AND c.hour = ?
	JOIN webhooks w ON w.deleted_at IS NULL AND (w.project_id IS NULL OR w.project_id = i.project_id)
	WHERE i.project_id = ? AND i.fingerprint = ? AND w.spike_threshold IS NOT NULL
		AND c.count = w.spike_threshold + 1
		AND NOT EXISTS (SELECT 1 FROM events WHERE project_id = ? AND event_id = ?)
		AND EXISTS (SELECT 1 FROM json_each(w.events) WHERE value = 'issue.spike')
		AND (w.min_trust = 'low' OR ${PROJECT_TRUST} = 'high')
	RETURNING id`;

/** The spike statement for the ingest batch: after the hourly count, before the event insert. */
export function spikeDeliveryStatement(
	projectId: number,
	fingerprint: string,
	eventId: string,
	nowIso: string,
): Statement {
	return {
		sql: SPIKE_SQL,
		params: [nowIso, nowIso, nowIso.slice(0, 13), projectId, fingerprint, projectId, eventId],
	};
}

/** The delivery statement for a fix verified in verifyFixes. */
export function verifiedDeliveryStatement(fixId: number, nowIso: string): Statement {
	return {
		sql: VERIFIED_SQL,
		params: ["issue.verified", nowIso, nowIso, fixId, nowIso, "issue.verified"],
	};
}

/** Starts the deliveries: through the notify queue, or after the response (`defer`). */
export function startDeliveries(ports: P): Promise<void> {
	if (ports.notifyQueue) return ports.notifyQueue.send({ kind: "deliver" });
	ports.defer(deliverDue(ports));
	return Promise.resolve();
}

const DUE_SQL = `SELECT id FROM webhook_deliveries
	WHERE status = 'pending' AND next_attempt_at <= ? AND (locked_until IS NULL OR locked_until <= ?)
	ORDER BY id LIMIT ?`;

/** Sends the deliveries that are due. Returns the number of attempts. */
export async function deliverDue(ports: P): Promise<number> {
	const now = ports.clock.now();
	const nowIso = now.toISOString();
	const due = await ports.db.all<{ id: number }>({
		sql: DUE_SQL,
		params: [nowIso, nowIso, DELIVERIES_PER_RUN],
	});
	const lockedUntil = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString();
	const attempts = await Promise.all(
		due.map(async ({ id }) => {
			// A lock, so that two runs do not send the same delivery at the same time.
			const locked = await ports.db.run(
				sql`UPDATE webhook_deliveries SET locked_until = ${lockedUntil}
					WHERE id = ${id} AND status = 'pending' AND (locked_until IS NULL OR locked_until <= ${nowIso})`,
			);
			if (locked.changes === 0) return 0;
			await attempt(ports, id);
			return 1;
		}),
	);
	return attempts.reduce<number>((sum, n) => sum + n, 0);
}

type DeliveryRow = {
	id: number;
	event: WebhookEvent;
	issue_id: number | null;
	attempts: number;
	created_at: string;
	webhook_id: number;
	uid: string;
	url: string;
	format: Format;
	secret: string;
	auth: string | null;
	recipients: string | null;
	data: string | null;
	deleted_at: string | null;
	project_deleted_at: string | null;
};

async function attempt(ports: P, id: number): Promise<void> {
	const row = await ports.db.first<DeliveryRow>(
		sql`SELECT d.id, d.event, d.issue_id, d.attempts, d.created_at, d.data, w.id AS webhook_id, w.uid,
				w.url, w.format, w.secret, w.auth, w.recipients, w.deleted_at,
				(SELECT p.deleted_at FROM issues i JOIN projects p ON p.id = i.project_id
					WHERE i.id = d.issue_id) AS project_deleted_at
			FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id WHERE d.id = ${id}`,
	);
	if (!row) return;
	const attempts = row.attempts + 1;
	let status: number | null = null;
	let error: string | null = null;
	try {
		if (row.deleted_at) throw new PermanentError("The webhook was deleted.");
		if (row.project_deleted_at) throw new PermanentError("The project was deleted.");
		const keys = ports.config.encryptionKeys;
		const extra = row.auth ? await decryptValue(keys, row.auth, authContext(row.uid)) : null;
		const { body: checkendBody, alert } = await payload(ports, row);
		if (row.format === "email") {
			if (!ports.mailer) throw new Error("Email is not configured (EMAIL and EMAIL_FROM).");
			const to = row.recipients ? (JSON.parse(row.recipients) as string[]) : [];
			await ports.mailer.send({ to, ...emailMessage(alert) });
		} else {
			// Slack and Discord: the stored URL is masked; the full URL is the encrypted extra.
			const target = row.format === "slack" || row.format === "discord" ? (extra ?? "") : row.url;
			const check = await checkOutboundUrl(target, ports.resolver);
			if (!check.ok) throw new Error(check.reason);
			const github = row.format === "github_dispatch" || row.format === "github_issue";
			const content =
				row.format === "slack"
					? slackMessage(alert)
					: row.format === "discord"
						? discordMessage(alert)
						: row.format === "github_issue"
							? githubIssue(alert)
							: row.format === "github_dispatch"
								? dispatchBody(checkendBody)
								: checkendBody;
			const body = JSON.stringify(content);
			const secret = await decryptValue(keys, row.secret, secretContext(row.uid));
			const timestamp = Math.floor(ports.clock.now().getTime() / 1000);
			const response = await ports.http.send(target, {
				method: "POST",
				body,
				redirect: "manual",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: {
					"content-type": "application/json",
					"user-agent": `Checkend-Webhook/${VERSION}`,
					"x-checkend-event": row.event,
					"x-checkend-delivery": String(row.id),
					"x-checkend-signature": `t=${timestamp},v1=${await hmacHex(secret, `${timestamp}.${body}`)}`,
					...(github && extra
						? {
								authorization: `Bearer ${extra}`,
								accept: "application/vnd.github+json",
								"x-github-api-version": "2022-11-28",
							}
						: {}),
				},
			});
			status = response.status;
			await response.body?.cancel();
			if (status < 200 || status >= 300) error = `HTTP ${status}`;
		}
	} catch (failure) {
		error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 300);
		if (failure instanceof PermanentError) {
			await finish(ports, id, "failed", attempts, null, error);
			return;
		}
	}
	if (error === null) {
		await finish(ports, id, "delivered", attempts, status, null);
		return;
	}
	const giveUp = attempts >= MAX_ATTEMPTS;
	const wait = BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 1440;
	const next = new Date(ports.clock.now().getTime() + wait * 60_000).toISOString();
	await ports.db.run(
		sql`UPDATE webhook_deliveries SET status = ${giveUp ? "failed" : "pending"}, attempts = ${attempts},
				next_attempt_at = ${next}, locked_until = NULL, last_status = ${status}, last_error = ${error}
			WHERE id = ${id}`,
	);
}

class PermanentError extends Error {}

async function finish(
	ports: P,
	id: number,
	status: "delivered" | "failed",
	attempts: number,
	httpStatus: number | null,
	error: string | null,
) {
	const nowIso = ports.clock.now().toISOString();
	await ports.db.run(
		sql`UPDATE webhook_deliveries SET status = ${status}, attempts = ${attempts}, locked_until = NULL,
				last_status = ${httpStatus}, last_error = ${error},
				delivered_at = ${status === "delivered" ? nowIso : null}
			WHERE id = ${id}`,
	);
}

/**
 * The Checkend body (the event, the issue and its brief, built at delivery time), and the alert
 * content for the channels for people.
 */
async function payload(ports: P, row: DeliveryRow) {
	const now = ports.clock.now();
	const issue = row.issue_id === null ? null : await getIssue(ports.db, row.issue_id, now);
	const brief =
		row.issue_id === null ? null : await buildBrief(ports.db, row.issue_id, now, ports.blobs);
	const project = issue
		? await ports.db.first<{ name: string }>(
				sql`SELECT p.name FROM projects p JOIN issues i ON i.project_id = p.id WHERE i.id = ${row.issue_id}`,
			)
		: null;
	const spike = row.data
		? (JSON.parse(row.data) as { events_1h?: number; threshold?: number })
		: null;
	const alert: AlertContent = {
		event: row.event,
		issue: issue && {
			id: Number(issue.id),
			status: String(issue.status),
			trust: String(issue.trust),
			priority: Number(issue.priority),
			events_24h: Number(issue.events_24h),
			users_affected: Number(issue.users_affected),
			first_seen: String(issue.first_seen),
		},
		project: project?.name ?? null,
		title_untrusted: issue ? String(issue.title) : null,
		culprit_untrusted: issue?.culprit ? String(issue.culprit) : null,
		spike:
			spike?.events_1h !== undefined && spike.threshold !== undefined
				? { events_1h: spike.events_1h, threshold: spike.threshold }
				: null,
		brief_markdown: brief?.markdown ?? null,
	};
	return {
		alert,
		body: {
			event: row.event,
			delivery_id: row.id,
			webhook_id: row.webhook_id,
			created_at: row.created_at,
			issue: issue && {
				id: formatIssueId(Number(issue.id)),
				project_id: issue.project_id,
				status: issue.status,
				level: issue.level,
				trust: issue.trust,
				priority: issue.priority,
				times_seen: issue.times_seen,
				users_affected: issue.users_affected,
				first_seen: issue.first_seen,
				last_seen: issue.last_seen,
				fix: issue.fix,
				title_untrusted: issue.title,
			},
			brief,
		},
	};
}

/**
 * A GitHub repository_dispatch body. client_payload has at most 10 top-level keys (a GitHub
 * limit); the brief is its Markdown text, which the workflow gives to the agent.
 */
function dispatchBody(content: Awaited<ReturnType<typeof payload>>["body"]) {
	return {
		event_type: `checkend.${content.event}`,
		client_payload: {
			event: content.event,
			delivery_id: content.delivery_id,
			webhook_id: content.webhook_id,
			issue: content.issue,
			brief_markdown: content.brief?.markdown ?? null,
		},
	};
}

async function hmacHex(secret: string, text: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
	return [...signature].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Encrypts webhook secrets again with the current key (rotation). Returns the number of
 * values changed. A value whose key is not in ENCRYPTION_KEYS stays as it is.
 */
export async function reencryptSecrets(ports: P): Promise<number> {
	const current = ports.config.encryptionKeys[0];
	if (!current) return 0;
	const rows = await ports.db.all<{ id: number; uid: string; secret: string; auth: string | null }>(
		sql`SELECT id, uid, secret, auth FROM webhooks
			WHERE secret NOT LIKE ${`enc1:${current.id}:%`} OR auth NOT LIKE ${`enc1:${current.id}:%`}
			LIMIT 50`,
	);
	const again = async (value: string, context: string) =>
		keyIdOf(value) === current.id
			? value
			: encryptValue(
					ports.config.encryptionKeys,
					await decryptValue(ports.config.encryptionKeys, value, context),
					context,
				);
	let changed = 0;
	for (const row of rows) {
		try {
			const secret = await again(row.secret, secretContext(row.uid));
			const auth = row.auth === null ? null : await again(row.auth, authContext(row.uid));
			await ports.db.run(
				sql`UPDATE webhooks SET secret = ${secret}, auth = ${auth}
					WHERE id = ${row.id} AND secret = ${row.secret} AND auth IS ${row.auth}`,
			);
			changed++;
		} catch {
			// An old key is not listed: the values stay until the key is back.
		}
	}
	return changed;
}
