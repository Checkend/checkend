import { DatabaseSync, type StatementSync } from "node:sqlite";
import {
	type BatchResult,
	checkStatement,
	type Db,
	type Row,
	type RunResult,
	type Statement,
} from "../../ports/db";

const STATEMENT_CACHE_SIZE = 500;

/**
 * `Db` on SQLite with the built-in `node:sqlite` module (D16). It is the database of the
 * Node entry and the fast test database. `batch()` runs in one transaction. The calls are
 * synchronous inside, so no other statement can run between the statements of a batch.
 */
export function openSqliteDb(path: string): Db {
	const database = new DatabaseSync(path);
	// Same behaviour as D1: foreign keys on. WAL suits one writer with many readers.
	database.exec("PRAGMA foreign_keys = ON");
	if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");

	const statements = new Map<string, StatementSync>();
	const prepare = (text: string): StatementSync => {
		let prepared = statements.get(text);
		if (!prepared) {
			if (statements.size >= STATEMENT_CACHE_SIZE) statements.clear();
			prepared = database.prepare(text);
			statements.set(text, prepared);
		}
		return prepared;
	};
	const totalChanges = prepare("SELECT total_changes() AS n");

	const execute = (statement: Statement): BatchResult => {
		checkStatement(statement);
		const before = Number(totalChanges.get()?.n);
		const rows = prepare(statement.sql)
			.all(...statement.params)
			.map((row) => ({ ...row }) as Row);
		const changes = Number(totalChanges.get()?.n) - before;
		return { changes, rows };
	};

	return {
		async all<T extends Row = Row>(statement: Statement): Promise<T[]> {
			return execute(statement).rows as T[];
		},

		async first<T extends Row = Row>(statement: Statement): Promise<T | null> {
			return (execute(statement).rows[0] as T | undefined) ?? null;
		},

		async run(statement: Statement): Promise<RunResult> {
			return { changes: execute(statement).changes };
		},

		async batch(batch: readonly Statement[]): Promise<BatchResult[]> {
			for (const statement of batch) checkStatement(statement);
			if (batch.length === 0) return [];
			database.exec("BEGIN IMMEDIATE");
			try {
				const results = batch.map(execute);
				database.exec("COMMIT");
				return results;
			} catch (error) {
				database.exec("ROLLBACK");
				throw error;
			}
		},
	};
}
