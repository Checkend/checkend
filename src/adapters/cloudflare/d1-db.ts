import {
	type BatchResult,
	checkStatement,
	type Db,
	type Row,
	type RunResult,
	type SqlValue,
	type Statement,
} from "../../ports/db.ts";

/** `Db` on Cloudflare D1 (D16). D1 runs each `batch()` as one transaction. */
export function d1Db(d1: D1Database): Db {
	const prepare = (statement: Statement): D1PreparedStatement => {
		checkStatement(statement);
		return d1.prepare(statement.sql).bind(...statement.params);
	};

	const toResult = (result: D1Result<Record<string, unknown>>): BatchResult => ({
		changes: result.meta.changes ?? 0,
		rows: (result.results ?? []).map(toRow),
	});

	return {
		async all<T extends Row = Row>(statement: Statement): Promise<T[]> {
			const result = await prepare(statement).all<Record<string, unknown>>();
			return result.results.map(toRow) as T[];
		},

		async first<T extends Row = Row>(statement: Statement): Promise<T | null> {
			const rows = await this.all<T>(statement);
			return rows[0] ?? null;
		},

		async run(statement: Statement): Promise<RunResult> {
			const result = await prepare(statement).run();
			return { changes: result.meta.changes ?? 0 };
		},

		async batch(statements: readonly Statement[]): Promise<BatchResult[]> {
			const prepared = statements.map(prepare);
			if (prepared.length === 0) return [];
			const results = await d1.batch<Record<string, unknown>>(prepared);
			return results.map(toResult);
		},
	};
}

// D1 returns BLOB columns as arrays of bytes. The port returns Uint8Array, like SQLite.
function toRow(raw: Record<string, unknown>): Row {
	const row: Row = {};
	for (const [column, value] of Object.entries(raw)) {
		row[column] = toSqlValue(value);
	}
	return row;
}

function toSqlValue(value: unknown): SqlValue {
	if (Array.isArray(value)) return Uint8Array.from(value as number[]);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return value as SqlValue;
}
