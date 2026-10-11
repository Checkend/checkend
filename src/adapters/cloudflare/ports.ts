import { systemClock } from "../../core/clock.ts";
import { fetchClient } from "../../ports/http.ts";
import type { Ports } from "../../ports/index.ts";
import { noRateLimit, type RateLimiter } from "../../ports/rate-limiter.ts";
import { type ConfigEnv, readConfig } from "../config-env.ts";
import { d1Db } from "./d1-db.ts";
import { cloudflareMailer, type EmailBinding } from "./email-mailer.ts";
import { cloudflareIngestQueue } from "./ingest-queue.ts";
import { type AiBinding, cloudflareModelRunner } from "./model-runner.ts";
import { r2BlobStore } from "./r2-blob-store.ts";
import { dohResolver } from "./resolver.ts";

export { type ConfigEnv, readConfig };

type WorkerEnv = Omit<Env, "INGEST_RATE_LIMITER"> &
	ConfigEnv & {
		// Optional binding: an install without it has no rate limit (H4: optional bindings).
		INGEST_RATE_LIMITER?: Pick<RateLimit, "limit">;
		// Optional binding: a queue that starts webhook deliveries. Without it, deliveries run
		// after the response (waitUntil), and the cron retries them.
		NOTIFY?: Pick<Queue<{ kind: "deliver" }>, "send">;
		// Optional binding: an R2 bucket for source maps. Without it, source maps are off.
		BLOBS?: Pick<R2Bucket, "put" | "get" | "delete">;
		// Optional binding: the ingest overflow queue. Without it, an overloaded D1 gives 429.
		INGEST_QUEUE?: Pick<Queue<object>, "send">;
		// Optional binding: Email Service (send_email). Email alerts need it and EMAIL_FROM.
		EMAIL?: EmailBinding;
		// Optional binding: Workers AI. The AI features need it (and their flags).
		AI?: AiBinding;
	};

function rateLimiter(binding: WorkerEnv["INGEST_RATE_LIMITER"]): RateLimiter {
	if (!binding) return noRateLimit;
	return { allow: async (key) => (await binding.limit({ key })).success };
}

/** Builds the ports from the Worker bindings and the execution context. */
export function cloudflarePorts(env: WorkerEnv, ctx: Pick<ExecutionContext, "waitUntil">): Ports {
	const config = readConfig(env);
	return {
		db: d1Db(env.DB),
		clock: systemClock,
		defer: (task) => ctx.waitUntil(task),
		rateLimiter: rateLimiter(env.INGEST_RATE_LIMITER),
		config,
		resolver: dohResolver,
		clientIp: (request) => request.headers.get("cf-connecting-ip") ?? "unknown",
		blobs: env.BLOBS ? r2BlobStore(env.BLOBS) : null,
		ingestQueue: env.INGEST_QUEUE ? cloudflareIngestQueue(env.INGEST_QUEUE) : null,
		mailer: env.EMAIL && env.EMAIL_FROM ? cloudflareMailer(env.EMAIL, env.EMAIL_FROM) : null,
		http: fetchClient,
		models: env.AI
			? cloudflareModelRunner(env.AI, {
					id: config.ai.gatewayId,
					collectLog: config.ai.gatewayLogs,
				})
			: null,
		notifyQueue: env.NOTIFY
			? { send: async (message) => void (await env.NOTIFY?.send(message)) }
			: null,
	};
}
