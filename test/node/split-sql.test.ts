import { describe, expect, it } from "vitest";
import { splitSql } from "../../src/core/migrations.ts";

describe("splitSql", () => {
	it("splits statements on semicolons and trims them", () => {
		expect(splitSql("CREATE TABLE a (x INTEGER);\n\nCREATE TABLE b (y TEXT);\n")).toEqual([
			"CREATE TABLE a (x INTEGER)",
			"CREATE TABLE b (y TEXT)",
		]);
	});

	it("keeps a last statement without a semicolon", () => {
		expect(splitSql("SELECT 1; SELECT 2")).toEqual(["SELECT 1", "SELECT 2"]);
	});

	it("ignores semicolons inside strings and quoted identifiers", () => {
		const text = `INSERT INTO t VALUES ('a;b', 'it''s; ok'); CREATE TABLE "x;y" (\`c;d\` TEXT, [e;f] TEXT);`;
		expect(splitSql(text)).toEqual([
			"INSERT INTO t VALUES ('a;b', 'it''s; ok')",
			'CREATE TABLE "x;y" (`c;d` TEXT, [e;f] TEXT)',
		]);
	});

	it("ignores semicolons in comments, drops comments before a statement, keeps inner ones", () => {
		const text = [
			"-- Migration 0001; the first one",
			"CREATE TABLE a (x INTEGER); -- trailing; comment",
			"/* block; comment */",
			"CREATE TABLE b (y TEXT /* inline; */);",
			"-- only a comment at the end;",
		].join("\n");
		expect(splitSql(text)).toEqual([
			"CREATE TABLE a (x INTEGER)",
			"CREATE TABLE b (y TEXT /* inline; */)",
		]);
	});

	it("returns no statements for empty or comment-only text", () => {
		expect(splitSql("")).toEqual([]);
		expect(splitSql("  -- nothing here\n/* nor here */ ;\n")).toEqual([]);
	});

	it("rejects CREATE TRIGGER, because its body has semicolons", () => {
		expect(() =>
			splitSql("CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET n = n + 1; END;"),
		).toThrow(/TRIGGER/);
	});
});
