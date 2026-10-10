import { describe, expect, it } from "vitest";
import { checkStatement, MAX_PARAMS, sql } from "../../src/ports/db.ts";

describe("sql tagged template", () => {
	it("turns each interpolated value into a bound parameter", () => {
		const name = "x'); DROP TABLE t; --";
		const s = sql`SELECT * FROM t WHERE name = ${name} AND n > ${3}`;
		expect(s.sql).toBe("SELECT * FROM t WHERE name = ? AND n > ?");
		expect(s.params).toEqual([name, 3]);
	});

	it("makes a statement with no parameters", () => {
		expect(sql`SELECT 1`).toEqual({ sql: "SELECT 1", params: [] });
	});
});

describe("checkStatement", () => {
	it(`accepts ${MAX_PARAMS} parameters`, () => {
		const params = Array.from({ length: MAX_PARAMS }, (_, i) => i);
		expect(() => checkStatement({ sql: "SELECT 1", params })).not.toThrow();
	});

	it(`rejects more than ${MAX_PARAMS} parameters (D1 limit)`, () => {
		const params = Array.from({ length: MAX_PARAMS + 1 }, (_, i) => i);
		expect(() => checkStatement({ sql: "SELECT 1", params })).toThrow(/at most 100/);
	});

	it.each([
		["undefined", undefined],
		["a boolean", true],
		["a bigint", 1n],
		["an object", { a: 1 }],
		["a Date", new Date()],
		["NaN", Number.NaN],
		["Infinity", Number.POSITIVE_INFINITY],
	])("rejects %s as a parameter", (_label, value) => {
		expect(() => checkStatement({ sql: "SELECT ?", params: [value as never] })).toThrow(
			/parameter 1/,
		);
	});

	it("accepts strings, numbers, null and bytes", () => {
		expect(() =>
			checkStatement({ sql: "SELECT ?, ?, ?, ?", params: ["a", 1.5, null, new Uint8Array([1])] }),
		).not.toThrow();
	});

	it("rejects SQL text above 100 KB (D1 limit)", () => {
		const big = `SELECT '${"a".repeat(100 * 1024)}'`;
		expect(() => checkStatement({ sql: big, params: [] })).toThrow(/100 KB/);
	});
});
