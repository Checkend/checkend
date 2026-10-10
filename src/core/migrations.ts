import { type Db, type Statement, sql } from "../ports/db.ts";

/**
 * Migrations (D16, D17 rule 5): one set of plain SQL files in `migrations/`, valid on D1 and
 * SQLite. On Cloudflare, `wrangler d1 migrations apply` runs them. Elsewhere (Node, tests),
 * `applyMigrations()` runs them and records them in the same `d1_migrations` table.
 */

/**
 * Splits SQL text into statements on `;`. Semicolons in strings, quoted identifiers and
 * comments do not split. Comments before a statement are dropped; comment-only parts too.
 * Triggers are not supported: their bodies contain semicolons.
 */
export function splitSql(text: string): string[] {
	const statements: string[] = [];
	let current = "";
	let i = 0;

	const finish = () => {
		const statement = current.trim();
		if (statement) statements.push(statement);
		current = "";
	};

	while (i < text.length) {
		const char = text[i] as string;
		const next = text[i + 1];

		if (char === "-" && next === "-") {
			const end = text.indexOf("\n", i);
			const stop = end === -1 ? text.length : end;
			if (current.trim()) current += text.slice(i, stop);
			i = stop;
		} else if (char === "/" && next === "*") {
			const end = text.indexOf("*/", i + 2);
			const stop = end === -1 ? text.length : end + 2;
			if (current.trim()) current += text.slice(i, stop);
			i = stop;
		} else if (char === "'" || char === '"' || char === "`" || char === "[") {
			const close = char === "[" ? "]" : char;
			let j = i + 1;
			while (j < text.length) {
				if (text[j] === close) {
					// A doubled quote inside a string is an escaped quote.
					if (close !== "]" && text[j + 1] === close) {
						j += 2;
						continue;
					}
					break;
				}
				j++;
			}
			current += text.slice(i, j + 1);
			i = j + 1;
		} else if (char === ";") {
			finish();
			i++;
		} else {
			current += char;
			i++;
		}
	}
	finish();

	for (const statement of statements) {
		if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(statement)) {
			throw new Error("Migrations cannot contain CREATE TRIGGER: splitSql() does not support it.");
		}
	}
	return statements;
}

// A type alias (not an interface), so that it is plain JSON for test bindings.
export type Migration = {
	/** The file name, for example `0001_init.sql`. Wrangler uses the same name. */
	name: string;
	sql: string;
};

export interface MigrationLevel {
	/** The number in the name of the last applied migration; 0 when none is applied. */
	level: number;
	/** The name of the last applied migration. */
	latest: string | null;
	/** How many migrations are applied. */
	applied: number;
}

// The table and format that `wrangler d1 migrations apply` uses. Both runners must agree.
const MIGRATIONS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

// A fixed-width number makes name order equal to number order, as Wrangler expects.
const MIGRATION_NAME = /^(\d{4})_[A-Za-z0-9_-]+\.sql$/;

/**
 * Applies the migrations that are not yet recorded, in name order. Each migration runs as
 * one atomic `batch()` together with its record, so a failed migration leaves no trace.
 * Returns the names it applied.
 */
export async function applyMigrations(db: Db, migrations: readonly Migration[]): Promise<string[]> {
	for (const { name } of migrations) {
		if (!MIGRATION_NAME.test(name)) {
			throw new Error(`Invalid migration name "${name}". Use the form 0001_description.sql.`);
		}
	}
	await db.run({ sql: MIGRATIONS_TABLE_SQL, params: [] });
	const done = new Set(
		(await db.all<{ name: string }>(sql`SELECT name FROM d1_migrations`)).map((row) => row.name),
	);

	const pending = [...migrations]
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
		.filter((migration) => !done.has(migration.name));

	for (const migration of pending) {
		const statements: Statement[] = splitSql(migration.sql).map((text) => ({
			sql: text,
			params: [],
		}));
		statements.push(sql`INSERT INTO d1_migrations (name) VALUES (${migration.name})`);
		await db.batch(statements);
	}
	return pending.map((migration) => migration.name);
}

/** Reads the migration level from the database. Works with either runner. */
export async function migrationLevel(db: Db): Promise<MigrationLevel> {
	const table = await db.first(
		sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'`,
	);
	if (!table) return { level: 0, latest: null, applied: 0 };

	const rows = await db.all<{ name: string }>(sql`SELECT name FROM d1_migrations ORDER BY id`);
	const latest = rows.at(-1)?.name ?? null;
	const number = latest?.match(MIGRATION_NAME)?.[1];
	return { level: number ? Number(number) : 0, latest, applied: rows.length };
}
