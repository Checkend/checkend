import {
	type BatchResult,
	checkStatement,
	type Db,
	type Row,
	type SqlValue,
	type Statement,
} from "../../ports/db.ts";

/** The part of a Durable Object's storage that the adapter uses (SQLite backend). */
export interface DurableSqlStorage {
	sql: {
		exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
	};
	transactionSync<T>(closure: () => T): T;
}

/**
 * `Db` on the SQLite database of a Durable Object (one hosted install). The SQL API is
 * synchronous; the port is async, so each method returns a settled promise. A batch runs in
 * `transactionSync`: an error rolls back every statement of it. Cursors are read at once
 * (toArray), never across an await.
 */
export function durableObjectDb(storage: DurableSqlStorage): Db {
	const totalChanges = () =>
		Number(storage.sql.exec("SELECT total_changes() AS n").toArray()[0]?.n ?? 0);

	const execute = (statement: Statement): BatchResult => {
		checkStatement(statement);
		const before = totalChanges();
		const rows = storage.sql
			.exec(statement.sql, ...statement.params.map(toBinding))
			.toArray()
			.map(toRow);
		return { rows, changes: totalChanges() - before };
	};

	return {
		async all<T extends Row = Row>(statement: Statement): Promise<T[]> {
			return execute(statement).rows as T[];
		},
		async first<T extends Row = Row>(statement: Statement): Promise<T | null> {
			return (execute(statement).rows[0] as T | undefined) ?? null;
		},
		async run(statement: Statement) {
			return { changes: execute(statement).changes };
		},
		async batch(statements: readonly Statement[]): Promise<BatchResult[]> {
			if (statements.length === 0) return [];
			statements.forEach(checkStatement);
			return storage.transactionSync(() => statements.map(execute));
		},
	};
}

// Bytes are bound as an ArrayBuffer (the type the SQL API documents for BLOBs).
const toBinding = (value: SqlValue): unknown =>
	value instanceof Uint8Array
		? value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
		: value;

// BLOB columns come back as ArrayBuffer. The port returns Uint8Array, like SQLite and D1.
function toRow(raw: Record<string, unknown>): Row {
	const row: Row = {};
	for (const [column, value] of Object.entries(raw)) {
		row[column] = value instanceof ArrayBuffer ? new Uint8Array(value) : (value as SqlValue);
	}
	return row;
}
