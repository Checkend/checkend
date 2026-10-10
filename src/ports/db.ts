/**
 * The database port. SQL only, async, bound parameters only.
 * Adapters: D1 (`adapters/cloudflare`) and SQLite (`adapters/node`).
 *
 * Portable rules:
 * - No interactive transactions. Use `batch()` for atomic writes.
 * - SQL must be valid on both D1 and SQLite.
 * - Values go in bound parameters, never in the SQL text. Use the `sql` tag.
 */

/** A value that can be bound to a parameter or read from a column. */
export type SqlValue = string | number | null | Uint8Array;

export type Row = Record<string, SqlValue>;

export interface Statement {
	readonly sql: string;
	readonly params: readonly SqlValue[];
}

export interface RunResult {
	/** Rows inserted, updated or deleted by the statement. */
	changes: number;
}

export interface BatchResult<T extends Row = Row> extends RunResult {
	/** Rows from a SELECT or a RETURNING clause; empty otherwise. */
	rows: T[];
}

export interface Db {
	all<T extends Row = Row>(statement: Statement): Promise<T[]>;
	first<T extends Row = Row>(statement: Statement): Promise<T | null>;
	run(statement: Statement): Promise<RunResult>;
	/**
	 * Runs the statements in order, atomically: all of them apply, or none do and the
	 * promise rejects. Results are in the same order as the statements.
	 */
	batch(statements: readonly Statement[]): Promise<BatchResult[]>;
}

/** D1 allows at most 100 bound parameters per statement. */
export const MAX_PARAMS = 100;

/** D1 allows at most 100 KB of SQL text per statement. */
export const MAX_SQL_BYTES = 100 * 1024;

/**
 * Builds a statement. Each interpolated value becomes a `?` parameter:
 * sql`SELECT * FROM issues WHERE id = ${id}`
 */
export function sql(strings: TemplateStringsArray, ...params: SqlValue[]): Statement {
	return { sql: strings.join("?"), params };
}

/** Throws when a statement breaks a limit that one of the adapters has. Adapters call it. */
export function checkStatement(statement: Statement): void {
	const { params } = statement;
	if (params.length > MAX_PARAMS) {
		throw new RangeError(
			`A statement can have at most ${MAX_PARAMS} parameters; this one has ${params.length}. Split it.`,
		);
	}
	if (new TextEncoder().encode(statement.sql).byteLength > MAX_SQL_BYTES) {
		throw new RangeError("SQL text is above 100 KB. Put values in parameters or split it.");
	}
	params.forEach((value, i) => {
		if (!isSqlValue(value)) {
			throw new TypeError(
				`SQL parameter ${i + 1} is not a string, finite number, null or Uint8Array.`,
			);
		}
	});
}

function isSqlValue(value: unknown): value is SqlValue {
	return (
		value === null ||
		typeof value === "string" ||
		(typeof value === "number" && Number.isFinite(value)) ||
		value instanceof Uint8Array
	);
}
