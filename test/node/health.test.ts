import { describe, expect, it } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { fixedClock } from "../../src/core/clock.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { createApp } from "../../src/http/app.ts";
import type { Db } from "../../src/ports/db.ts";
import type { Ports } from "../../src/ports/index.ts";

const migrations = readMigrations("migrations");
const latest = migrations.at(-1)?.name;
const clock = fixedClock(new Date("2026-10-10T12:00:00Z"));

const brokenDb: Db = {
	all: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	first: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	run: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
	batch: () => Promise.reject(new Error("D1_ERROR: secret internal detail")),
};

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
		const { status, headers, body } = await getHealth({ db, clock });
		expect(status).toBe(200);
		expect(headers.get("cache-control")).toBe("no-store");
		expect(body).toEqual({
			status: "ok",
			version: pkg.version,
			migrations: { level: Number(latest?.slice(0, 4)), latest, applied: migrations.length },
			time: "2026-10-10T12:00:00.000Z",
		});
	});

	it("reports level 0 before any migration", async () => {
		const { status, body } = await getHealth({ db: openSqliteDb(":memory:"), clock });
		expect(status).toBe(200);
		expect(body.migrations).toEqual({ level: 0, latest: null, applied: 0 });
	});

	it("returns 503 without internal details when the database fails", async () => {
		const { status, body } = await getHealth({ db: brokenDb, clock });
		expect(status).toBe(503);
		expect(body).toEqual({
			status: "error",
			version: pkg.version,
			migrations: null,
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
			{ ports: { db: openSqliteDb(":memory:"), clock } },
		);
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "not_found" });
	});
});
