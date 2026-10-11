// The Node entry: Checkend without Cloudflare, as one process with one SQLite file.
// Run: node src/entry/server.ts (Docker: see Dockerfile). Settings are environment variables:
// the same names as the Worker (ADMIN_TOKEN, ENCRYPTION_KEYS, RETENTION_DAYS, ...), plus:
//   DATABASE_PATH          the SQLite file (default data/checkend.sqlite)
//   PORT, HOST             default 8787 and 0.0.0.0
//   BLOBS_DIR              a folder for blobs (source maps, large payloads), or S3:
//   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
//   SMTP_URL, EMAIL_FROM   email alerts: smtps://user:password@host:465 (or smtp:// for a relay)
//   TRUSTED_PROXIES        proxies whose X-Forwarded-For is read (addresses, CIDR, loopback, private)
//   RATE_LIMIT_PER_MINUTE  per DSN key (default 1000; 0: no limit)
//   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN  Workers AI through AI Gateway (REST API), for
//                          the AI features (AI_TRIAGE, AI_SIMILAR). Without them: no AI.
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { type ConfigEnv, readConfig } from "../adapters/config-env.ts";
import { clientIpResolver } from "../adapters/node/client-ip.ts";
import { processCpuClock } from "../adapters/node/cpu-clock.ts";
import { nodeDefer } from "../adapters/node/defer.ts";
import { fsBlobStore } from "../adapters/node/fs-blob-store.ts";
import { pinnedHttpClient } from "../adapters/node/http-client.ts";
import { runJobs, sqliteJobQueue } from "../adapters/node/jobs-queue.ts";
import { readMigrations } from "../adapters/node/migrations-fs.ts";
import { restModelRunner } from "../adapters/node/model-runner.ts";
import { tokenBucketLimiter } from "../adapters/node/rate-limiter.ts";
import { systemResolver } from "../adapters/node/resolver.ts";
import { s3BlobStore } from "../adapters/node/s3-blob-store.ts";
import { smtpMailer } from "../adapters/node/smtp-mailer.ts";
import { openSqliteDb } from "../adapters/node/sqlite-db.ts";
import { sqliteVectorIndex } from "../adapters/node/vector-index.ts";
import { systemClock } from "../core/clock.ts";
import { consumeIngest } from "../core/ingest/overflow.ts";
import { IngestState } from "../core/ingest/state.ts";
import { applyMigrations } from "../core/migrations.ts";
import { runScheduled } from "../core/scheduler.ts";
import { createApp } from "../http/app.ts";
import type { BlobStore } from "../ports/blob-store.ts";
import { fetchClient } from "../ports/http.ts";
import type { Ports } from "../ports/index.ts";
import type { Mailer } from "../ports/mailer.ts";
import { noRateLimit } from "../ports/rate-limiter.ts";

export type NodeEnv = ConfigEnv & Record<string, string | undefined>;

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const JOB_POLL_MS = 1000;
const SCHEDULE_MS = 5 * 60_000;

function blobs(env: NodeEnv): BlobStore | null {
	if (env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
		return s3BlobStore({
			endpoint: env.S3_ENDPOINT,
			region: env.S3_REGION ?? "auto",
			bucket: env.S3_BUCKET,
			accessKeyId: env.S3_ACCESS_KEY_ID,
			secretAccessKey: env.S3_SECRET_ACCESS_KEY,
		});
	}
	if (env.BLOBS_DIR) {
		mkdirSync(env.BLOBS_DIR, { recursive: true });
		return fsBlobStore(env.BLOBS_DIR);
	}
	return null;
}

function mailer(env: NodeEnv): Mailer | null {
	if (!env.SMTP_URL || !env.EMAIL_FROM) return null;
	const url = new URL(env.SMTP_URL);
	const secure = url.protocol === "smtps:";
	if (!secure && url.protocol !== "smtp:")
		throw new Error("SMTP_URL must start with smtps:// or smtp://");
	// Without TLS, AUTH PLAIN would send the password in clear text: smtp:// is for a relay only.
	if (!secure && (url.username || url.password)) {
		throw new Error(
			"SMTP_URL: a user and password need smtps:// (TLS); smtp:// is for a relay without them.",
		);
	}
	return smtpMailer({
		host: url.hostname,
		port: Number(url.port || (secure ? 465 : 25)),
		secure,
		...(url.username ? { username: decodeURIComponent(url.username) } : {}),
		...(url.password ? { password: decodeURIComponent(url.password) } : {}),
		from: env.EMAIL_FROM,
	});
}

export interface RunningServer {
	url: string;
	ports: Ports;
	/** Stops taking requests, waits for background work, and stops the loops. */
	stop(): Promise<void>;
}

export async function startServer(env: NodeEnv): Promise<RunningServer> {
	// Settings that can be wrong fail before the database opens.
	const mail = mailer(env);
	const path = env.DATABASE_PATH ?? "data/checkend.sqlite";
	if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
	const db = openSqliteDb(path);
	await applyMigrations(db, readMigrations(MIGRATIONS_DIR));
	const { defer, drain } = nodeDefer();
	const config = readConfig(env);
	const perMinute =
		env.RATE_LIMIT_PER_MINUTE === undefined ? 1000 : Number(env.RATE_LIMIT_PER_MINUTE);
	const ports: Ports = {
		db,
		clock: systemClock,
		defer,
		rateLimiter:
			perMinute > 0 ? tokenBucketLimiter({ limit: perMinute, periodMs: 60_000 }) : noRateLimit,
		config,
		vectors: sqliteVectorIndex(db),
		cpuClock: processCpuClock,
		resolver: systemResolver,
		http: pinnedHttpClient(),
		models:
			env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN
				? restModelRunner({
						accountId: env.CLOUDFLARE_ACCOUNT_ID,
						apiToken: env.CLOUDFLARE_API_TOKEN,
						gateway: { id: config.ai.gatewayId, collectLog: config.ai.gatewayLogs },
						http: fetchClient,
					})
				: null,
		notifyQueue: null,
		blobs: blobs(env),
		ingestQueue: sqliteJobQueue(db, "ingest", systemClock),
		mailer: mail,
		clientIp: () => "unknown",
	};
	const clientIp = clientIpResolver(env.TRUSTED_PROXIES);
	const state = new IngestState();
	const app = createApp({ state });

	// The loops: queued ingest events, and the scheduled jobs (fix verification, retries, ...).
	let stopping = false;
	const loop = (every: number, work: () => Promise<unknown>) => {
		let running = false;
		const timer = setInterval(() => {
			if (running || stopping) return;
			running = true;
			defer(work().finally(() => (running = false)));
		}, every);
		timer.unref();
		return timer;
	};
	const timers = [
		loop(JOB_POLL_MS, () =>
			runJobs(db, systemClock, "ingest", (items) => consumeIngest(ports, state, items)),
		),
		loop(SCHEDULE_MS, () => runScheduled(ports, new Date())),
	];

	const server = serve({
		fetch: (request, bindings) =>
			app.fetch(request, {
				ports: {
					...ports,
					clientIp: (r: Request) => clientIp(bindings.incoming.socket.remoteAddress, r),
				},
			}),
		port: Number(env.PORT ?? 8787),
		hostname: env.HOST ?? "0.0.0.0",
	});
	// A port in use (EADDRINUSE) must fail the start, not wait for ever.
	try {
		await new Promise<void>((done, fail) => {
			server.once("listening", done);
			server.once("error", fail);
		});
	} catch (error) {
		stopping = true;
		for (const timer of timers) clearInterval(timer);
		await drain();
		db.close();
		throw error;
	}
	const address = server.address();
	const port = typeof address === "object" && address ? address.port : Number(env.PORT ?? 8787);
	return {
		url: `http://${env.HOST && env.HOST !== "0.0.0.0" ? env.HOST : "127.0.0.1"}:${port}`,
		ports,
		async stop() {
			stopping = true;
			for (const timer of timers) clearInterval(timer);
			await new Promise<void>((done) => server.close(() => done()));
			await drain();
			// After the drain: the WAL is checkpointed into the main file.
			db.close();
		},
	};
}

// Run as a program: start, and stop cleanly on SIGTERM and SIGINT.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const running = await startServer(process.env);
	console.log(JSON.stringify({ message: "checkend: listening", url: running.url }));
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.once(signal, () => {
			console.log(JSON.stringify({ message: `checkend: ${signal}, stopping` }));
			running.stop().then(
				() => process.exit(0),
				(error) => {
					console.error(JSON.stringify({ message: "checkend: stop failed", error: String(error) }));
					process.exit(1);
				},
			);
		});
	}
}
