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
import type { FrontIdentity } from "../core/auth/front-identity.ts";
import { systemClock } from "../core/clock.ts";
import { IngestState } from "../core/ingest/state.ts";
import { applyMigrations } from "../core/migrations.ts";
import { runScheduled } from "../core/scheduler.ts";
import { type Actor, createToken } from "../core/tokens.ts";
import { createApp } from "../http/app.ts";
import { parseBasePath } from "../http/base-path.ts";
import { type BlobStore, prefixedBlobStore } from "../ports/blob-store.ts";
import type { Config } from "../ports/config.ts";
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

/**
 * Where an install lives, set once by the front Worker (`provision`): its base path under the
 * shared public origin, and the spaces page of the front Worker.
 */
export interface Provision {
	basePath: string;
	publicUrl: string;
	spacesUrl: string | null;
}

const PROVISION_KEY = "provision";

/** An http(s) URL without user info, query or fragment; `originOnly`: also without a path. */
function checkedUrl(value: unknown, originOnly: boolean): string {
	const url = typeof value === "string" && URL.canParse(value) ? new URL(value) : null;
	if (
		!url ||
		(url.protocol !== "https:" && url.protocol !== "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		(originOnly && url.pathname !== "/")
	) {
		throw new Error(`checkend: not a valid URL for an install: ${JSON.stringify(value)}`);
	}
	return originOnly ? url.origin : url.href;
}

export class CheckendInstall extends DurableObject<InstallEnv> {
	private readonly db: Db;
	private readonly state = new IngestState();
	private readonly app = createApp({ state: this.state });
	private provisioned: Provision | null = null;

	constructor(ctx: DurableObjectState, env: InstallEnv) {
		super(ctx, env);
		this.db = durableObjectDb(ctx.storage);
		// The first start after a deploy applies new migrations before any request runs.
		ctx.blockConcurrencyWhile(async () => {
			await applyMigrations(this.db, MIGRATIONS);
			this.provisioned = (await ctx.storage.get<Provision>(PROVISION_KEY)) ?? null;
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

	/**
	 * The settings of this install. The Worker environment is shared by all installs, so it gives
	 * only operational settings: no secret (admin token, setup code, GitHub secrets) and no
	 * development mode. Members come only from the front Worker (trusted front identity).
	 */
	config(): Config {
		const config = readConfig(this.env);
		return {
			...config,
			// The front Worker makes a token per install (createAdminToken).
			adminToken: null,
			// No setup link: the front Worker signs people in.
			setupCode: null,
			// Per install, when they come: shared values would work across installs.
			githubWebhookSecret: null,
			githubToken: null,
			devMode: false,
			trustedFront: true,
			publicUrl: this.provisioned?.publicUrl ?? null,
			basePath: this.provisioned?.basePath ?? "",
			spacesUrl: this.provisioned?.spacesUrl ?? null,
		};
	}

	private ports(): Ports {
		const config = this.config();
		const limiter = this.env.INGEST_RATE_LIMITER;
		const rateLimiter: RateLimiter = limiter
			? { allow: async (key) => (await limiter.limit({ key: `${this.ctx.id}:${key}` })).success }
			: noRateLimit;
		return {
			db: this.db,
			clock: systemClock,
			defer: (task) => this.ctx.waitUntil(task),
			rateLimiter,
			config,
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

	/** Without a member identity: bearer API, MCP, ingest and public pages. */
	override fetch(request: Request): Promise<Response> {
		return this.serve(request, null);
	}

	/**
	 * RPC for the front Worker: a request with the member identity that it signed in (null: none).
	 * The identity is an argument of this call, which only the front Worker can make.
	 */
	serve(request: Request, identity: FrontIdentity | null): Promise<Response> {
		return Promise.resolve(this.app.fetch(request, { ports: this.ports(), identity }));
	}

	/**
	 * RPC for the front Worker: where this install lives. Set once; the same base path again is a
	 * no-op (a retry), another one is refused. Returns an error instead of throwing.
	 */
	async provision(input: Provision): Promise<{ ok: true } | { ok: false; error: string }> {
		let next: Provision;
		try {
			next = {
				basePath: parseBasePath(input.basePath),
				publicUrl: checkedUrl(input.publicUrl, true),
				spacesUrl: input.spacesUrl === null ? null : checkedUrl(input.spacesUrl, false),
			};
		} catch (error) {
			return { ok: false, error: (error as Error).message };
		}
		if (next.basePath === "") return { ok: false, error: "a hosted install needs a base path" };
		if (this.provisioned && this.provisioned.basePath !== next.basePath) {
			return { ok: false, error: "this install is provisioned under another base path" };
		}
		await this.ctx.storage.put(PROVISION_KEY, next);
		this.provisioned = next;
		return { ok: true };
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
