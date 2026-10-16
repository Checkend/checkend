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
import { deriveInstallKeys, type EncryptionKey } from "../core/crypto.ts";
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

/**
 * The scheduled jobs run every 5 minutes while the install is in use, like the cron of the
 * Worker; each job decides by time. An install with no request for IDLE_AFTER_MS runs them only
 * every IDLE_ALARM_MS: each alarm is a billed request and wakes the object, and many spaces are
 * not used for long times. A request makes the install active again. IDLE_AFTER_MS is longer
 * than the quiet period of fix verification (24 hours by default).
 */
export const ACTIVE_ALARM_MS = 5 * 60_000;
export const IDLE_ALARM_MS = 6 * 3_600_000;
export const IDLE_AFTER_MS = 3 * 86_400_000;
/** The time of the last request (ms), written at most once per ACTIVITY_WRITE_MS. */
export const ACTIVITY_KEY = "last_activity";
const ACTIVITY_WRITE_MS = 3_600_000;

/**
 * The events per UTC day of a hosted install when DAILY_EVENT_LIMIT does not set a lower value.
 * Ingest is public (a browser DSN is in the page), so without a limit one DSN could make an
 * install write rows without end, and the Cloud pays for each row.
 */
export const HOSTED_DAILY_EVENT_LIMIT = 10_000;

/** The front Worker: the only caller of the RPC methods (a Durable Object is not on the internet). */
const FRONT: Actor = { type: "system", id: null, name: "front worker", scopes: ["admin"] };

export type InstallEnv = ConfigEnv & {
	/** One bucket for all installs; each install keeps its keys under installs/<id>/. */
	BLOBS?: Pick<R2Bucket, "put" | "get" | "delete" | "list">;
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

/** The base path and public origin of a request (see serve). */
export type InstallLocation = Pick<Provision, "basePath" | "publicUrl"> & { standIn?: boolean };

const PROVISION_KEY = "provision";
/** Written by destroy() after all data is deleted: the install stays deleted. */
const TOMBSTONE_KEY = "tombstone";

/**
 * The key of the ingest rate limit (per DSN key): by the base path when the install has one, so
 * that a stand-in install (see serve) and the real install of a path count alike.
 */
export function ingestLimitKey(basePath: string, objectId: string, key: string): string {
	return `${basePath || objectId}:${key}`;
}

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
	/** The encryption keys of this install, derived from the shared ENCRYPTION_KEYS at start. */
	private encryptionKeys: EncryptionKey[] = [];
	/** Set by destroy(): until the object restarts (empty), it refuses every request. */
	private destroyed = false;
	/** The stored time of the last request (ACTIVITY_KEY); 0: none. */
	private activityAt = 0;

	constructor(ctx: DurableObjectState, env: InstallEnv) {
		super(ctx, env);
		this.db = durableObjectDb(ctx.storage);
		// The first start after a deploy applies new migrations before any request runs.
		ctx.blockConcurrencyWhile(async () => {
			// A deleted install stays deleted after a restart: no migrations, no alarm, no answers.
			if ((await ctx.storage.get<boolean>(TOMBSTONE_KEY)) === true) {
				this.destroyed = true;
				return;
			}
			await applyMigrations(this.db, MIGRATIONS);
			this.provisioned = (await ctx.storage.get<Provision>(PROVISION_KEY)) ?? null;
			this.activityAt = (await ctx.storage.get<number>(ACTIVITY_KEY)) ?? 0;
			this.encryptionKeys = await deriveInstallKeys(
				readConfig(env).encryptionKeys,
				ctx.id.toString(),
			);
			if (this.provisioned) await this.startAlarm();
		});
	}

	private async startAlarm(): Promise<void> {
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + ACTIVE_ALARM_MS);
		}
	}

	/**
	 * Records a request: at most one write per hour. The write also brings an idle install back
	 * to the 5-minute alarm.
	 */
	private async touch(): Promise<void> {
		const now = Date.now();
		if (now - this.activityAt < ACTIVITY_WRITE_MS) return;
		this.activityAt = now;
		await this.ctx.storage.put(ACTIVITY_KEY, now);
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm === null || alarm > now + ACTIVE_ALARM_MS) {
			await this.ctx.storage.setAlarm(now + ACTIVE_ALARM_MS);
		}
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
	 * development mode; the encryption keys are derived per install. Members come only from the
	 * front Worker (trusted front identity).
	 */
	config(at: InstallLocation | null = null): Config {
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
			// Its own keys: a value of one install does not decrypt in another.
			encryptionKeys: this.encryptionKeys,
			devMode: false,
			dailyEventLimit: Math.min(
				config.dailyEventLimit ?? HOSTED_DAILY_EVENT_LIMIT,
				HOSTED_DAILY_EVENT_LIMIT,
			),
			trustedFront: true,
			publicUrl: this.provisioned?.publicUrl ?? at?.publicUrl ?? null,
			basePath: this.provisioned?.basePath ?? at?.basePath ?? "",
			spacesUrl: this.provisioned?.spacesUrl ?? null,
		};
	}

	private ports(at: InstallLocation | null = null): Ports {
		const config = this.config(at);
		const limiter = this.env.INGEST_RATE_LIMITER;
		const rateLimiter: RateLimiter = limiter
			? {
					allow: async (key) =>
						(
							await limiter.limit({
								key: ingestLimitKey(config.basePath ?? "", this.ctx.id.toString(), key),
							})
						).success,
				}
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
	 *
	 * `at`: where the request is for. A provisioned install refuses another base path. An install
	 * that is not provisioned refuses every request, except in the stand-in mode that the call asks
	 * for (`at.standIn`, never with an identity): it answers under the base path of the call, for
	 * this request only. A front Worker sends requests for unknown paths to empty stand-in installs,
	 * so that they get the same answers as a real install that gets no valid credentials.
	 */
	async serve(
		request: Request,
		identity: FrontIdentity | null,
		at: InstallLocation | null = null,
	): Promise<Response> {
		const refused = () => Promise.resolve(Response.json({ error: "not_found" }, { status: 404 }));
		if (this.destroyed) return refused();
		const standIn = at?.standIn === true;
		if (this.provisioned ? standIn : !standIn || identity !== null) return refused();
		let location: InstallLocation | null = null;
		if (at !== null) {
			try {
				location = {
					basePath: parseBasePath(at.basePath),
					publicUrl: checkedUrl(at.publicUrl, true),
				};
			} catch {
				return refused();
			}
			if (location.basePath === "") return refused();
			if (this.provisioned && this.provisioned.basePath !== location.basePath) return refused();
		}
		if (this.provisioned) await this.touch();
		const ports = this.ports(this.provisioned ? null : location);
		return this.app.fetch(request, { ports, identity });
	}

	/**
	 * RPC for the front Worker, when a space is deleted: all data of this install (its blobs in the
	 * shared bucket, its database and its alarm). The blobs go first, one list page (at most 1000
	 * keys) at a time: when a call fails, the front Worker calls destroy() again, and it goes on.
	 */
	async destroy(): Promise<void> {
		this.destroyed = true;
		this.provisioned = null;
		await this.ctx.storage.deleteAlarm();
		const bucket = this.env.BLOBS;
		if (bucket) {
			const prefix = this.blobPrefix();
			// Deleted keys leave the list, so each pass lists from the start until none is left.
			for (;;) {
				const page = await bucket.list({ prefix, limit: 1000 });
				const keys = page.objects
					.map((object) => object.key)
					.filter((key) => key.startsWith(prefix));
				if (keys.length === 0) break;
				await bucket.delete(keys);
			}
		}
		await this.ctx.storage.deleteAll();
		await this.ctx.storage.put(TOMBSTONE_KEY, true);
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
		if (this.destroyed) return { ok: false, error: "this install is deleted" };
		if (next.basePath === "") return { ok: false, error: "a hosted install needs a base path" };
		if (this.provisioned && this.provisioned.basePath !== next.basePath) {
			return { ok: false, error: "this install is provisioned under another base path" };
		}
		await this.ctx.storage.put(PROVISION_KEY, next);
		this.provisioned = next;
		await this.touch();
		await this.startAlarm();
		return { ok: true };
	}

	/** One alarm for all scheduled jobs (fix verification, retries, retention, ...). Idempotent. */
	override async alarm(): Promise<void> {
		// A deleted or a stand-in install has no jobs: its alarm ends here.
		if (this.destroyed || !this.provisioned) {
			await this.ctx.storage.deleteAlarm();
			return;
		}
		// The next alarm first: a failed run is retried by the platform, and the chain goes on.
		this.activityAt = (await this.ctx.storage.get<number>(ACTIVITY_KEY)) ?? 0;
		const idle = Date.now() - this.activityAt > IDLE_AFTER_MS;
		await this.ctx.storage.setAlarm(Date.now() + (idle ? IDLE_ALARM_MS : ACTIVE_ALARM_MS));
		await runScheduled(this.ports(), new Date());
	}

	/** RPC for the front Worker: an admin token of this install (shown once; only its hash is stored). */
	async createAdminToken(name: string): Promise<string> {
		const { token } = await createToken(this.ports(), FRONT, { name, scopes: ["admin"] });
		return token;
	}
}
