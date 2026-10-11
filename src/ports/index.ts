import type { BlobStore } from "./blob-store.ts";
import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { CpuClock } from "./cpu-clock.ts";
import type { Db } from "./db.ts";
import type { Defer } from "./defer.ts";
import type { HttpClient, NotifyQueue } from "./http.ts";
import type { IngestQueue } from "./ingest-queue.ts";
import type { Mailer } from "./mailer.ts";
import type { ModelRunner } from "./model-runner.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import type { Resolver } from "./resolver.ts";
import type { VectorIndex } from "./vector-index.ts";

export type { BlobStore } from "./blob-store.ts";
export type { Clock } from "./clock.ts";
export type { Config } from "./config.ts";
export type { CpuClock } from "./cpu-clock.ts";
export type { Db } from "./db.ts";
export type { Defer } from "./defer.ts";
export type { HttpClient, NotifyQueue } from "./http.ts";
export type { IngestQueue } from "./ingest-queue.ts";
export type { Mailer } from "./mailer.ts";
export type { ModelRunner } from "./model-runner.ts";
export type { RateLimiter } from "./rate-limiter.ts";
export type { Resolver } from "./resolver.ts";
export type { VectorIndex } from "./vector-index.ts";

/**
 * Everything the app needs from its runtime. Each entry builds one from its environment:
 * `adapters/cloudflare/ports.ts` for the Worker. Add a port when the first feature needs it.
 */
export interface Ports {
	db: Db;
	clock: Clock;
	defer: Defer;
	rateLimiter: RateLimiter;
	config: Config;
	/** DNS, for the SSRF check of webhook URLs. */
	resolver: Resolver;
	/** Outgoing requests (webhooks). */
	http: HttpClient;
	/** Starts webhook deliveries; null: deliveries run in `defer` and in the cron. */
	notifyQueue: NotifyQueue | null;
	/** Large values (source maps); null: no storage, so the features that need it are off. */
	blobs: BlobStore | null;
	/** The ingest overflow queue; null: no queue (direct mode only, 429 when D1 is overloaded). */
	ingestQueue: IngestQueue | null;
	/** Email for alerts; null: email alerts are off. */
	mailer: Mailer | null;
	/** Workers AI models, always through AI Gateway; null: no AI (the AI features are off). */
	models: ModelRunner | null;
	/** Vectors of issues for similar issues; null: similar issues are off. */
	vectors: VectorIndex | null;
	/** The CPU time of the process (Node), for the scrub pattern check; null on Workers. */
	cpuClock: CpuClock | null;
	/**
	 * The address of the client, for per-client rate limits. Workers: cf-connecting-ip. Node: the
	 * socket address, or X-Forwarded-For from trusted proxies only (TRUSTED_PROXIES).
	 */
	clientIp(request: Request): string;
}
