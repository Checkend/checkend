import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { applyMigrations } from "../../src/core/migrations.ts";
import { createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

describe("backup", () => {
	it("writes a consistent copy of the database while it is open", async () => {
		const dir = mkdtempSync(join(tmpdir(), "checkend-backup-"));
		const source = join(dir, "checkend.sqlite");
		const db = openSqliteDb(source);
		await applyMigrations(db, readMigrations("migrations"));
		const { ports } = await testPorts({ db });
		await createProject(ports, { name: "Backed up" });
		const target = join(dir, "backup.sqlite");
		execFileSync(process.execPath, ["scripts/backup.ts", target], {
			env: { ...process.env, DATABASE_PATH: source, NODE_NO_WARNINGS: "1" },
		});
		const copy = openSqliteDb(target);
		expect(await copy.first(sql`SELECT name FROM projects`)).toEqual({ name: "Backed up" });
		expect(() =>
			execFileSync(process.execPath, ["scripts/backup.ts", target], {
				env: { ...process.env, DATABASE_PATH: source },
				stdio: "pipe",
			}),
		).toThrow(/exists/);
	});
});
