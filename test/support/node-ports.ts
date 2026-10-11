import { processCpuClock } from "../../src/adapters/node/cpu-clock.ts";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { type FixedClock, fixedClock } from "../../src/core/clock.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { memoryBlobStore } from "../../src/ports/blob-store.ts";
import { type Config, DEFAULT_CONFIG } from "../../src/ports/config.ts";
import type { Ports } from "../../src/ports/index.ts";
import { noRateLimit } from "../../src/ports/rate-limiter.ts";
import { noResolver } from "../../src/ports/resolver.ts";

/** Tests have no network: a test that sends webhooks passes its own HttpClient. */
const noNetwork = { send: async () => Promise.reject(new Error("No network in tests.")) };

export interface TestPorts {
	ports: Ports;
	clock: FixedClock;
	/** Waits until all deferred work is done (like the end of ctx.waitUntil). */
	settle(): Promise<void>;
}

/** Ports for Node tests: a migrated in-memory SQLite database and a fixed clock. */
export async function testPorts(
	overrides: Partial<Omit<Ports, "config">> & { config?: Partial<Config> } = {},
): Promise<TestPorts> {
	const db = overrides.db ?? openSqliteDb(":memory:");
	await applyMigrations(db, readMigrations("migrations"));
	const clock = fixedClock(new Date("2026-10-10T12:00:00Z"));
	const pending: Promise<unknown>[] = [];
	const ports: Ports = {
		db,
		clock,
		defer: (task) => {
			pending.push(task);
		},
		rateLimiter: noRateLimit,
		resolver: noResolver,
		http: noNetwork,
		notifyQueue: null,
		blobs: memoryBlobStore(),
		ingestQueue: null,
		mailer: null,
		models: null,
		vectors: null,
		cpuClock: processCpuClock,
		clientIp: (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown",
		...overrides,
		config: { ...DEFAULT_CONFIG, ...overrides.config },
	};
	return {
		ports,
		clock,
		settle: async () => {
			while (pending.length > 0) await Promise.allSettled(pending.splice(0));
		},
	};
}
