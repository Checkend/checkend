import { applyD1Migrations, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { d1Db } from "../../src/adapters/cloudflare/d1-db.ts";
import { applyMigrations, migrationLevel } from "../../src/core/migrations.ts";
import { sql } from "../../src/ports/db.ts";
import { migrationsContract } from "../contract/migrations-contract.ts";

const db = () => d1Db(env.DB);
const reset = async () => {
	// Views first: a view can depend on a table.
	const objects = await db().all<{ name: string; type: string }>(
		sql`SELECT name, type FROM sqlite_master WHERE type IN ('view', 'table')
			AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY type DESC`,
	);
	await db().batch(
		objects.map(({ name, type }) => ({
			// biome-ignore lint/plugin: test reset drops the views and tables that sqlite_master lists.
			sql: `DROP ${type === "view" ? "VIEW" : "TABLE"} "${name}"`,
			params: [],
		})),
	);
};

migrationsContract(
	"D1 (workerd)",
	async () => {
		await reset();
		return db();
	},
	() => env.TEST_MIGRATIONS,
);

describe("migrations: Wrangler runner and Checkend runner agree", () => {
	it("reads the level that wrangler d1 migrations apply leaves", async () => {
		await reset();
		await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
		const level = await migrationLevel(db());
		expect(level.applied).toBe(env.TEST_MIGRATIONS.length);
		expect(level.latest).toBe(env.TEST_MIGRATIONS.at(-1)?.name);
	});

	it("applies nothing after Wrangler applied the same files", async () => {
		await reset();
		await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
		expect(await applyMigrations(db(), env.TEST_MIGRATIONS)).toEqual([]);
	});
});
