// The hosted-install entry: one Durable Object is one Checkend install for one organization,
// with its own SQLite database. A front Worker finds the install and forwards requests to it
// (stub.fetch), and sets it up over RPC. The same app, ports and migrations as the Worker and
// the Node server; this entry only builds the ports from the object.
import { DurableObject } from "cloudflare:workers";
import { durableObjectDb } from "../adapters/cloudflare/do-sqlite-db.ts";
import { cloudflareMailer, type EmailBinding } from "../adapters/cloudflare/email-mailer.ts";
import { type AiBinding, cloudflareModelRunner } from "../adapters/cloudflare/model-runner.ts";
import { r2BlobStore } from "../adapters/cloudflare/r2-blob-store.ts";
import { dohResolver } from "../adapters/cloudflare/resolver.ts";
import { type ConfigEnv, readConfig } from "../adapters/config-env.ts";
import { systemClock } from "../core/clock.ts";
import { IngestState } from "../core/ingest/state.ts";
import { applyMigrations } from "../core/migrations.ts";
import { runScheduled } from "../core/scheduler.ts";
import { type Actor, createToken } from "../core/tokens.ts";
import { createApp } from "../http/app.ts";
import { type BlobStore, prefixedBlobStore } from "../ports/blob-store.ts";
import type { Db } from "../ports/db.ts";
import { fetchClient } from "../ports/http.ts";
import type { Ports } from "../ports/index.ts";
import { noRateLimit, type RateLimiter } from "../ports/rate-limiter.ts";
import { MIGRATIONS } from "./migrations.generated.ts";

/** The scheduled jobs run every 5 minutes, like the cron of the Worker; each job decides by time. */
const ALARM_MS = 5 * 60_000;

/** The front Worker: the only caller of the RPC methods (a Durable Object is not on the internet). */
const FRONT: Actor = { type: "system", id: null, name: "front worker", scopes: ["admin"] };

export type InstallEnv = ConfigEnv & {
	/** One bucket for all installs; each install keeps its keys under installs/<id>/. */
	BLOBS?: Pick<R2Bucket, "put" | "get" | "delete">;
	INGEST_RATE_LIMITER?: Pick<RateLimit, "limit">;
	EMAIL?: EmailBinding;
	AI?: AiBinding;
};

export class CheckendInstall extends DurableObject<InstallEnv> {
	private readonly db: Db;
	private readonly state = new IngestState();
	private readonly app = createApp({ state: this.state });

	constructor(ctx: DurableObjectState, env: InstallEnv) {
		super(ctx, env);
		this.db = durableObjectDb(ctx.storage);
		// The first start after a deploy applies new migrations before any request runs.
		ctx.blockConcurrencyWhile(async () => {
			await applyMigrations(this.db, MIGRATIONS);
			if ((await ctx.storage.getAlarm()) === null)
				await ctx.storage.setAlarm(Date.now() + ALARM_MS);
		});
	}

	/** The key prefix of this install in the shared bucket. */
	blobPrefix(): string {
		return `installs/${this.ctx.id.toString()}/`;
	}

	blobs(): BlobStore | null {
		return this.env.BLOBS
			? prefixedBlobStore(r2BlobStore(this.env.BLOBS), this.blobPrefix())
			: null;
	}

	private ports(): Ports {
		const config = readConfig(this.env);
		const limiter = this.env.INGEST_RATE_LIMITER;
		const rateLimiter: RateLimiter = limiter
			? { allow: async (key) => (await limiter.limit({ key: `${this.ctx.id}:${key}` })).success }
			: noRateLimit;
		return {
			db: this.db,
			clock: systemClock,
			defer: (task) => this.ctx.waitUntil(task),
			rateLimiter,
			// The Worker's ADMIN_TOKEN is shared by all installs: never an admin of one. The front
			// Worker makes a token per install (createAdminToken).
			config: { ...config, adminToken: null },
			resolver: dohResolver,
			http: fetchClient,
			// Direct mode: one object writes its own database; deliveries run in defer and the alarm.
			notifyQueue: null,
			ingestQueue: null,
			blobs: this.blobs(),
			mailer:
				this.env.EMAIL && this.env.EMAIL_FROM
					? cloudflareMailer(this.env.EMAIL, this.env.EMAIL_FROM)
					: null,
			models: this.env.AI
				? cloudflareModelRunner(this.env.AI, {
						id: config.ai.gatewayId,
						collectLog: config.ai.gatewayLogs,
					})
				: null,
			// Similar issues need a Vectorize namespace per install: not yet.
			vectors: null,
			cpuClock: null,
			// The front Worker sets the client's address in cf-connecting-ip.
			clientIp: (request) => request.headers.get("cf-connecting-ip") ?? "unknown",
		};
	}

	override fetch(request: Request): Promise<Response> {
		return Promise.resolve(this.app.fetch(request, { ports: this.ports() }));
	}

	/** One alarm for all scheduled jobs (fix verification, retries, retention, ...). Idempotent. */
	override async alarm(): Promise<void> {
		// The next alarm first: a failed run is retried by the platform, and the chain goes on.
		await this.ctx.storage.setAlarm(Date.now() + ALARM_MS);
		await runScheduled(this.ports(), new Date());
	}

	/** RPC for the front Worker: an admin token of this install (shown once; only its hash is stored). */
	async createAdminToken(name: string): Promise<string> {
		const { token } = await createToken(this.ports(), FRONT, { name, scopes: ["admin"] });
		return token;
	}
}
