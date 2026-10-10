import { systemClock } from "../../core/clock.ts";
import { parseEncryptionKeys } from "../../core/crypto.ts";
import { type Config, DEFAULT_CONFIG } from "../../ports/config.ts";
import { fetchClient } from "../../ports/http.ts";
import type { Ports } from "../../ports/index.ts";
import { noRateLimit, type RateLimiter } from "../../ports/rate-limiter.ts";
import { d1Db } from "./d1-db.ts";
import { dohResolver } from "./resolver.ts";

/** Optional settings: Workers secrets (ADMIN_TOKEN) and vars. */
export interface ConfigEnv {
	ADMIN_TOKEN?: string;
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
}

type WorkerEnv = Omit<Env, "INGEST_RATE_LIMITER"> &
	ConfigEnv & {
		// Optional binding: an install without it has no rate limit (H4: optional bindings).
		INGEST_RATE_LIMITER?: Pick<RateLimit, "limit">;
		// Optional binding: a queue that starts webhook deliveries. Without it, deliveries run
		// after the response (waitUntil), and the cron retries them.
		NOTIFY?: Pick<Queue<{ kind: "deliver" }>, "send">;
	};

const positiveInt = (value: string | undefined): number | undefined => {
	const n = Number(value);
	return value && Number.isInteger(n) && n > 0 ? n : undefined;
};

function encryptionKeys(value: string | undefined) {
	const { keys, invalid } = parseEncryptionKeys(value);
	if (invalid.length > 0) {
		// Workers Logs. The key values are never logged, only their IDs.
		console.error(
			JSON.stringify({ message: "checkend: invalid ENCRYPTION_KEYS entries", ids: invalid }),
		);
	}
	return keys;
}

export function readConfig(env: ConfigEnv): Config {
	return {
		adminToken: env.ADMIN_TOKEN?.trim() || null,
		dailyRowLimit: positiveInt(env.D1_DAILY_ROW_LIMIT) ?? DEFAULT_CONFIG.dailyRowLimit,
		eventsPerIssue: positiveInt(env.EVENTS_PER_ISSUE) ?? DEFAULT_CONFIG.eventsPerIssue,
		newIssuesPerHour: positiveInt(env.NEW_ISSUES_PER_HOUR) ?? DEFAULT_CONFIG.newIssuesPerHour,
		tagKeysPerProject: positiveInt(env.TAG_KEYS_PER_PROJECT) ?? DEFAULT_CONFIG.tagKeysPerProject,
		requireApproval: (env.REQUIRE_APPROVAL ?? "")
			.split(",")
			.map((a) => a.trim())
			.filter((a) => a === "ignore" || a === "merge"),
		verifyQuietHours: positiveInt(env.VERIFY_QUIET_HOURS) ?? DEFAULT_CONFIG.verifyQuietHours,
		githubWebhookSecret: env.GITHUB_WEBHOOK_SECRET?.trim() || null,
		encryptionKeys: encryptionKeys(env.ENCRYPTION_KEYS),
	};
}

function rateLimiter(binding: WorkerEnv["INGEST_RATE_LIMITER"]): RateLimiter {
	if (!binding) return noRateLimit;
	return { allow: async (key) => (await binding.limit({ key })).success };
}

/** Builds the ports from the Worker bindings and the execution context. */
export function cloudflarePorts(env: WorkerEnv, ctx: Pick<ExecutionContext, "waitUntil">): Ports {
	return {
		db: d1Db(env.DB),
		clock: systemClock,
		defer: (task) => ctx.waitUntil(task),
		rateLimiter: rateLimiter(env.INGEST_RATE_LIMITER),
		config: readConfig(env),
		resolver: dohResolver,
		http: fetchClient,
		notifyQueue: env.NOTIFY
			? { send: async (message) => void (await env.NOTIFY?.send(message)) }
			: null,
	};
}
