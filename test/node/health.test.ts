import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { fixedClock } from "../../src/core/clock.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { createApp } from "../../src/http/app.ts";
import { DEFAULT_CONFIG } from "../../src/ports/config.ts";
import { type Db, sql } from "../../src/ports/db.ts";
import type { Ports } from "../../src/ports/index.ts";
import { noRateLimit } from "../../src/ports/rate-limiter.ts";
import { noResolver } from "../../src/ports/resolver.ts";

const migrations = readMigrations("migrations");
const latest = migrations.at(-1)?.name;
const clock = fixedClock(new Date("2026-10-10T12:00:00Z"));

const brokenDb: Db = {
	all: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	first: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	run: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	batch: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
};

const portsWith = (db: Db): Ports => ({
	db,
	clock,
	defer: () => {},
	rateLimiter: noRateLimit,
	resolver: noResolver,
	http: { send: async () => new Response(null, { status: 599 }) },
	notifyQueue: null,
	blobs: null,
	ingestQueue: null,
	mailer: null,
	config: DEFAULT_CONFIG,
});

async function getHealth(ports: Ports) {
	const response = await createApp().request("/health", {}, { ports });
	return {
		status: response.status,
		headers: response.headers,
		body: (await response.json()) as Record<string, unknown>,
	};
}

describe("GET /health", () => {
	it("returns the version and the migration level", async () => {
		const db = openSqliteDb(":memory:");
		await applyMigrations(db, migrations);
		const { status, headers, body } = await getHealth(portsWith(db));
		expect(status).toBe(200);
		expect(headers.get("cache-control")).toBe("no-store");
		expect(body).toEqual({
			status: "ok",
			version: pkg.version,
			migrations: { level: Number(latest?.slice(0, 4)), latest, applied: migrations.length },
			ingest: { mode: "full", write_failures_today: 0, retry_after_seconds: 0 },
			time: "2026-10-10T12:00:00.000Z",
		});
	});

	it("reports level 0 before any migration", async () => {
		const { status, body } = await getHealth(portsWith(openSqliteDb(":memory:")));
		expect(status).toBe(200);
		expect(body.migrations).toEqual({ level: 0, latest: null, applied: 0 });
		expect(body.ingest).toBeNull();
	});

	it("shows budget mode and write failures (H1, H3)", async () => {
		const db = openSqliteDb(":memory:");
		await applyMigrations(db, migrations);
		await db.run(
			sql`INSERT INTO daily_usage (day, rows_written, write_failures) VALUES (${"2026-10-10"}, ${900}, ${2})`,
		);
		const ports = { ...portsWith(db), config: { ...DEFAULT_CONFIG, dailyRowLimit: 1000 } };
		const { body } = await getHealth(ports);
		expect(body.ingest).toEqual({
			mode: "counters_only",
			write_failures_today: 2,
			retry_after_seconds: 0,
		});
	});

	it("returns 503 without internal details when the database fails", async () => {
		const { status, body } = await getHealth(portsWith(brokenDb));
		expect(status).toBe(503);
		expect(body).toEqual({
			status: "error",
			version: pkg.version,
			migrations: null,
			ingest: null,
			time: "2026-10-10T12:00:00.000Z",
		});
		expect(JSON.stringify(body)).not.toContain("secret");
	});
});

describe("unknown routes", () => {
	it("return a JSON 404", async () => {
		const response = await createApp().request(
			"/nope",
			{},
			{ ports: portsWith(openSqliteDb(":memory:")) },
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "not_found" });
	});
});
