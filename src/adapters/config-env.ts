import { parseEncryptionKeys } from "../core/crypto.ts";
import { type Config, DEFAULT_CONFIG } from "../ports/config.ts";

/**
 * Settings from the environment: Workers secrets and vars, or environment variables on Node.
 * Both entries read the same names.
 */
export interface ConfigEnv {
	ADMIN_TOKEN?: string;
	/** A secret: the one-time setup code. `npm run setup-link` sets it. */
	SETUP_CODE?: string;
	D1_DAILY_ROW_LIMIT?: string;
	EVENTS_PER_ISSUE?: string;
	NEW_ISSUES_PER_HOUR?: string;
	TAG_KEYS_PER_PROJECT?: string;
	/** Comma-separated: ignore, merge. */
	REQUIRE_APPROVAL?: string;
	VERIFY_QUIET_HOURS?: string;
	/** A secret: the GitHub webhook secret. */
	GITHUB_WEBHOOK_SECRET?: string;
	/** A secret: "k2:<base64 of 32 bytes>,k1:<...>", the current key first. */
	ENCRYPTION_KEYS?: string;
	/** A secret: a GitHub token with read access to the repositories (commits per release). */
	GITHUB_TOKEN?: string;
	RETENTION_DAYS?: string;
	/** "1" or "true": development mode. `npm run dev` passes it; never set it in production. */
	CHECKEND_DEV?: string;
	/** The public origin, for example https://errors.example.com (Node behind a proxy). */
	PUBLIC_URL?: string;
	/** The sender of email alerts; a domain onboarded to Email Service. */
	EMAIL_FROM?: string;
	AI_GATEWAY_ID?: string;
	/** "on": the gateway stores prompts and responses. */
	AI_GATEWAY_LOGS?: string;
	/** "on": stock Clef triage. */
	AI_TRIAGE?: string;
	/** "on": embeddings and similar issues. */
	AI_SIMILAR?: string;
}

const on = (value: string | undefined) => value?.trim().toLowerCase() === "on";

const positiveInt = (value: string | undefined): number | undefined => {
	const n = Number(value);
	return value && Number.isInteger(n) && n > 0 ? n : undefined;
};

function encryptionKeys(value: string | undefined) {
	const { keys, invalid } = parseEncryptionKeys(value);
	if (invalid.length > 0) {
		// The logs. The key values are never logged, only their IDs.
		console.error(
			JSON.stringify({ message: "checkend: invalid ENCRYPTION_KEYS entries", ids: invalid }),
		);
	}
	return keys;
}

/** The admin bearer token compares without a rate limit on failed attempts: it must be long. */
export const MIN_ADMIN_TOKEN_CHARS = 32;

function adminToken(value: string | undefined): string | null {
	const token = value?.trim() || null;
	if (token && token.length < MIN_ADMIN_TOKEN_CHARS) {
		// The logs. Never the token itself.
		console.error(
			JSON.stringify({
				message: `checkend: ADMIN_TOKEN is ignored: it needs at least ${MIN_ADMIN_TOKEN_CHARS} characters (for example: openssl rand -base64 32)`,
			}),
		);
		return null;
	}
	return token;
}

/** PUBLIC_URL as an origin (scheme, host, port), or null when it is not set or not valid. */
function publicUrl(value: string | undefined): string | null {
	const text = value?.trim();
	if (!text) return null;
	let url: URL | null = null;
	try {
		url = new URL(text);
	} catch {}
	if (
		url &&
		(url.protocol === "https:" || url.protocol === "http:") &&
		!url.username &&
		!url.password &&
		url.pathname === "/" &&
		!url.search &&
		!url.hash
	) {
		return url.origin;
	}
	console.error(
		JSON.stringify({
			message:
				"checkend: PUBLIC_URL is ignored: it must be an http(s) origin without a path, for example https://errors.example.com",
		}),
	);
	return null;
}

export function readConfig(env: ConfigEnv): Config {
	return {
		adminToken: adminToken(env.ADMIN_TOKEN),
		setupCode: env.SETUP_CODE?.trim() || null,
		dailyRowLimit: positiveInt(env.D1_DAILY_ROW_LIMIT) ?? DEFAULT_CONFIG.dailyRowLimit,
		eventsPerIssue: positiveInt(env.EVENTS_PER_ISSUE) ?? DEFAULT_CONFIG.eventsPerIssue,
		newIssuesPerHour: positiveInt(env.NEW_ISSUES_PER_HOUR) ?? DEFAULT_CONFIG.newIssuesPerHour,
		tagKeysPerProject: positiveInt(env.TAG_KEYS_PER_PROJECT) ?? DEFAULT_CONFIG.tagKeysPerProject,
		requireApproval: (env.REQUIRE_APPROVAL ?? "")
			.split(",")
			.map((a) => a.trim())
			.filter((a) => a === "ignore" || a === "merge" || a === "delete_project"),
		verifyQuietHours: positiveInt(env.VERIFY_QUIET_HOURS) ?? DEFAULT_CONFIG.verifyQuietHours,
		githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET?.trim() || null,
		encryptionKeys: encryptionKeys(env.ENCRYPTION_KEYS),
		githubToken: env.GITHUB_TOKEN?.trim() || null,
		retentionDays: positiveInt(env.RETENTION_DAYS) ?? DEFAULT_CONFIG.retentionDays,
		ai: {
			gatewayId: env.AI_GATEWAY_ID?.trim() || DEFAULT_CONFIG.ai.gatewayId,
			gatewayLogs: on(env.AI_GATEWAY_LOGS),
			triage: on(env.AI_TRIAGE),
			similar: on(env.AI_SIMILAR),
		},
		devMode: env.CHECKEND_DEV === "1" || env.CHECKEND_DEV === "true",
		publicUrl: publicUrl(env.PUBLIC_URL),
	};
}
