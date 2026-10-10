import { beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, type Migration, migrationLevel } from "../../src/core/migrations.ts";
import { type Db, sql } from "../../src/ports/db.ts";

const first: Migration = {
	name: "0001_first.sql",
	sql: "CREATE TABLE m_one (id INTEGER PRIMARY KEY);\nCREATE TABLE m_two (id INTEGER PRIMARY KEY);",
};
const second: Migration = {
	name: "0002_second.sql",
	sql: "ALTER TABLE m_one ADD COLUMN label TEXT;",
};
const broken: Migration = {
	name: "0003_broken.sql",
	sql: "CREATE TABLE m_three (id INTEGER PRIMARY KEY);\nALTER TABLE m_missing ADD COLUMN x TEXT;",
};

const tableExists = async (db: Db, name: string) =>
	(await db.first(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${name}`)) !==
	null;

/**
 * The migrator must behave the same on every `Db` adapter (D16). `repoMigrations` is the
 * real set from `migrations/`; it must apply cleanly on each database.
 */
export function migrationsContract(
	adapterName: string,
	makeDb: () => Promise<Db> | Db,
	repoMigrations: () => Migration[],
): void {
	describe(`migrations: ${adapterName}`, () => {
		let db: Db;

		beforeEach(async () => {
			db = await makeDb();
			await db.batch(
				["d1_migrations", "m_one", "m_two", "m_three"].map((table) => ({
					sql: `DROP TABLE IF EXISTS ${table}`,
					params: [],
				})),
			);
		});

		it("reports level 0 on an empty database", async () => {
			expect(await migrationLevel(db)).toEqual({ level: 0, latest: null, applied: 0 });
		});

		it("applies pending migrations in name order and records them", async () => {
			expect(await applyMigrations(db, [second, first])).toEqual([first.name, second.name]);
			expect(await tableExists(db, "m_two")).toBe(true);
			await db.run(sql`INSERT INTO m_one (id, label) VALUES (${1}, ${"ok"})`);
			expect(await migrationLevel(db)).toEqual({ level: 2, latest: second.name, applied: 2 });
		});

		it("records migrations in the Wrangler table format", async () => {
			await applyMigrations(db, [first]);
			const rows = await db.all(sql`SELECT id, name, applied_at FROM d1_migrations`);
			expect(rows).toEqual([{ id: 1, name: first.name, applied_at: expect.any(String) }]);
		});

		it("applies nothing when every migration is already applied", async () => {
			await applyMigrations(db, [first, second]);
			expect(await applyMigrations(db, [first, second])).toEqual([]);
		});

		it("applies only the new migration when one is added", async () => {
			await applyMigrations(db, [first]);
			expect(await applyMigrations(db, [first, second])).toEqual([second.name]);
		});

		it("rolls back a failed migration completely and keeps the earlier ones", async () => {
			await expect(applyMigrations(db, [first, second, broken])).rejects.toThrow(/m_missing/);
			expect(await tableExists(db, "m_three")).toBe(false);
			expect(await migrationLevel(db)).toEqual({ level: 2, latest: second.name, applied: 2 });
		});

		it("rejects a migration name that Wrangler would not order the same way", async () => {
			await expect(applyMigrations(db, [{ name: "init.sql", sql: "SELECT 1" }])).rejects.toThrow(
				/name/,
			);
		});

		it("applies the repository's migrations", async () => {
			const migrations = repoMigrations();
			expect(migrations.length).toBeGreaterThan(0);
			await applyMigrations(db, migrations);
			const level = await migrationLevel(db);
			expect(level.applied).toBe(migrations.length);
			expect(level.latest).toBe(migrations.at(-1)?.name);
		});
	});
}
