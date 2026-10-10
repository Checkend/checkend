import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { migrationsContract } from "../contract/migrations-contract.ts";

migrationsContract(
	"SQLite (node:sqlite)",
	() => openSqliteDb(":memory:"),
	() => readMigrations("migrations"),
);

describe("readMigrations", () => {
	it("reads the .sql files of a folder in name order", () => {
		const dir = mkdtempSync(join(tmpdir(), "checkend-migrations-"));
		writeFileSync(join(dir, "0002_b.sql"), "SELECT 2;");
		writeFileSync(join(dir, "0001_a.sql"), "SELECT 1;");
		writeFileSync(join(dir, "README.md"), "not a migration");
		expect(readMigrations(dir)).toEqual([
			{ name: "0001_a.sql", sql: "SELECT 1;" },
			{ name: "0002_b.sql", sql: "SELECT 2;" },
		]);
	});
});
