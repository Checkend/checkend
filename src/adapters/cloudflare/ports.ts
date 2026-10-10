import { systemClock } from "../../core/clock.ts";
import { type Config, DEFAULT_CONFIG } from "../../ports/config.ts";
import type { Ports } from "../../ports/index.ts";
import { noRateLimit, type RateLimiter } from "../../ports/rate-limiter.ts";
import { d1Db } from "./d1-db.ts";

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
}

type WorkerEnv = Omit<Env, "INGEST_RATE_LIMITER"> &
	ConfigEnv & {
		// Optional binding: an install without it has no rate limit (H4: optional bindings).
		INGEST_RATE_LIMITER?: Pick<RateLimit, "limit">;
	};

const positiveInt = (value: string | undefined): number | undefined => {
	const n = Number(value);
	return value && Number.isInteger(n) && n > 0 ? n : undefined;
};

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
	};
}
