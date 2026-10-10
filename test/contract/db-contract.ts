import { beforeEach, describe, expect, it } from "vitest";
import { type Db, MAX_PARAMS, type Statement, sql } from "../../src/ports/db.ts";

/**
 * The behaviour every `Db` adapter must have. Each adapter's test file calls this
 * with a factory. Tests in workerd run it against D1, tests in Node against SQLite.
 */
export function dbContract(adapterName: string, makeDb: () => Promise<Db> | Db): void {
	describe(`Db contract: ${adapterName}`, () => {
		let db: Db;

		beforeEach(async () => {
			db = await makeDb();
			await db.batch([
				sql`DROP TABLE IF EXISTS contract_items`,
				sql`CREATE TABLE contract_items (
					id INTEGER PRIMARY KEY,
					name TEXT NOT NULL UNIQUE,
					score REAL,
					data BLOB
				)`,
			]);
		});

		const insert = (id: number, name: string, score: number | null = null): Statement =>
			sql`INSERT INTO contract_items (id, name, score) VALUES (${id}, ${name}, ${score})`;

		describe("run", () => {
			it("reports the number of changed rows", async () => {
				expect(await db.run(insert(1, "a"))).toEqual({ changes: 1 });
				await db.run(insert(2, "b"));
				expect(await db.run(sql`UPDATE contract_items SET score = ${1}`)).toEqual({
					changes: 2,
				});
				expect(await db.run(sql`DELETE FROM contract_items WHERE id = ${99}`)).toEqual({
					changes: 0,
				});
			});

			it("rejects when the SQL fails", async () => {
				await db.run(insert(1, "a"));
				await expect(db.run(insert(2, "a"))).rejects.toThrow(/UNIQUE/i);
			});
		});

		describe("all and first", () => {
			it("returns rows as plain objects with each SQLite type mapped", async () => {
				await db.run(
					sql`INSERT INTO contract_items (id, name, score, data)
						VALUES (${1}, ${"héllo ✓ 日本"}, ${2.5}, ${new Uint8Array([0, 1, 255])})`,
				);
				await db.run(insert(2, "b"));
				const rows = await db.all(sql`SELECT * FROM contract_items ORDER BY id`);
				expect(rows).toEqual([
					{ id: 1, name: "héllo ✓ 日本", score: 2.5, data: new Uint8Array([0, 1, 255]) },
					{ id: 2, name: "b", score: null, data: null },
				]);
				expect(rows[0]?.data).toBeInstanceOf(Uint8Array);
			});

			it("returns an empty array when nothing matches", async () => {
				expect(await db.all(sql`SELECT * FROM contract_items`)).toEqual([]);
			});

			it("first returns the first row, or null", async () => {
				await db.run(insert(1, "a"));
				await db.run(insert(2, "b"));
				expect(await db.first(sql`SELECT name FROM contract_items ORDER BY id DESC`)).toEqual({
					name: "b",
				});
				expect(await db.first(sql`SELECT name FROM contract_items WHERE id = ${9}`)).toBeNull();
			});

			it("returns rows from INSERT … RETURNING", async () => {
				const rows = await db.all(
					sql`INSERT INTO contract_items (id, name) VALUES (${7}, ${"r"}) RETURNING id, name`,
				);
				expect(rows).toEqual([{ id: 7, name: "r" }]);
			});

			it("binds values as data, never as SQL", async () => {
				const hostile = "x'); DROP TABLE contract_items; --";
				await db.run(insert(1, hostile));
				expect(await db.first(sql`SELECT name FROM contract_items`)).toEqual({ name: hostile });
			});
		});

		describe("batch", () => {
			it("returns an empty array for no statements", async () => {
				expect(await db.batch([])).toEqual([]);
			});

			it("runs the statements in order and returns one result per statement", async () => {
				const results = await db.batch([
					insert(1, "a"),
					insert(2, "b"),
					sql`UPDATE contract_items SET score = ${5} WHERE id = ${2}`,
					sql`SELECT id, score FROM contract_items ORDER BY id`,
				]);
				expect(results).toEqual([
					{ changes: 1, rows: [] },
					{ changes: 1, rows: [] },
					{ changes: 1, rows: [] },
					{
						changes: 0,
						rows: [
							{ id: 1, score: null },
							{ id: 2, score: 5 },
						],
					},
				]);
			});

			it("is atomic: when one statement fails, no statement applies", async () => {
				await db.run(insert(1, "a"));
				await expect(
					db.batch([
						insert(2, "b"),
						sql`UPDATE contract_items SET score = ${9} WHERE id = ${1}`,
						insert(3, "a"), // UNIQUE violation
					]),
				).rejects.toThrow(/UNIQUE/i);
				expect(await db.all(sql`SELECT id, score FROM contract_items`)).toEqual([
					{ id: 1, score: null },
				]);
			});

			it("supports the ingest pattern: upsert with ON CONFLICT", async () => {
				const upsert = (name: string) =>
					sql`INSERT INTO contract_items (id, name, score) VALUES (${1}, ${name}, ${1})
						ON CONFLICT (id) DO UPDATE SET score = score + 1`;
				await db.batch([upsert("a"), upsert("a"), upsert("a")]);
				expect(await db.first(sql`SELECT score FROM contract_items`)).toEqual({ score: 3 });
			});
		});

		describe("constraints", () => {
			it("enforces foreign keys (always on in D1)", async () => {
				await db.batch([
					sql`DROP TABLE IF EXISTS contract_children`,
					sql`CREATE TABLE contract_children (
						id INTEGER PRIMARY KEY,
						item_id INTEGER NOT NULL REFERENCES contract_items (id)
					)`,
				]);
				await expect(
					db.run(sql`INSERT INTO contract_children (id, item_id) VALUES (${1}, ${404})`),
				).rejects.toThrow(/FOREIGN KEY/i);
				await db.run(sql`DROP TABLE contract_children`);
			});
		});

		describe("limits", () => {
			const manyParams = (count: number): Statement => ({
				sql: `SELECT ${Array.from({ length: count }, () => "?").join(" + ")} AS total`,
				params: Array.from({ length: count }, () => 1),
			});

			it(`accepts ${MAX_PARAMS} parameters`, async () => {
				expect(await db.first(manyParams(MAX_PARAMS))).toEqual({ total: MAX_PARAMS });
			});

			it(`rejects ${MAX_PARAMS + 1} parameters in run, all, first and batch`, async () => {
				const tooMany = manyParams(MAX_PARAMS + 1);
				await expect(db.run(tooMany)).rejects.toThrow(/at most 100/);
				await expect(db.all(tooMany)).rejects.toThrow(/at most 100/);
				await expect(db.first(tooMany)).rejects.toThrow(/at most 100/);
				await expect(db.batch([insert(1, "a"), tooMany])).rejects.toThrow(/at most 100/);
				expect(await db.all(sql`SELECT id FROM contract_items`)).toEqual([]);
			});

			it("rejects a value that cannot be bound", async () => {
				const bad = { sql: "SELECT ?", params: [true as never] };
				await expect(db.run(bad)).rejects.toThrow(/parameter 1/);
			});
		});
	});
}
