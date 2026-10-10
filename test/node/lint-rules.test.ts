// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the samples are source code with ${} on purpose.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const biome = join(repoRoot, "node_modules/.bin/biome");
const sandbox = mkdtempSync(join(tmpdir(), "checkend-lint-"));
copyFileSync(join(repoRoot, "biome.json"), join(sandbox, "biome.json"));
cpSync(join(repoRoot, "lint"), join(sandbox, "lint"), { recursive: true });
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

// Writes `source` to `path` in a sandbox with the repo's biome.json, then runs only the
// import-restriction rule on it. Returns true when lint passes.
function lintPasses(path: string, source: string): boolean {
	const file = join(sandbox, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, source);
	const result = spawnSync(
		biome,
		["lint", "--vcs-enabled=false", "--only=style/noRestrictedImports", path],
		{
			cwd: sandbox,
			encoding: "utf8",
		},
	);
	if (result.status !== 0 && !result.stderr.includes("noRestrictedImports")) {
		throw new Error(`biome failed for another reason:\n${result.stdout}\n${result.stderr}`);
	}
	return result.status === 0;
}

const cloudflareImport = 'import { env } from "cloudflare:workers";\nexport const x = env;\n';
const nodeImport = 'import { readFile } from "node:fs/promises";\nexport const x = readFile;\n';

describe("lint rule: cloudflare:* imports", () => {
	it.each([
		"src/core/a.ts",
		"src/ports/a.ts",
		"src/http/a.ts",
		"src/adapters/node/a.ts",
		"src/entry/server.ts",
	])("rejects a cloudflare:* import in %s", (path) => {
		expect(lintPasses(path, cloudflareImport)).toBe(false);
	});

	it.each(["src/adapters/cloudflare/a.ts", "src/entry/worker.ts"])(
		"allows a cloudflare:* import in %s",
		(path) => {
			expect(lintPasses(path, cloudflareImport)).toBe(true);
		},
	);
});

describe("lint rule: Web Standard APIs only in core, ports and http", () => {
	it.each(["src/core/b.ts", "src/ports/b.ts", "src/http/b.ts"])(
		"rejects a node:* import in %s",
		(path) => {
			expect(lintPasses(path, nodeImport)).toBe(false);
		},
	);

	it("allows a node:* import in the Node adapter", () => {
		expect(lintPasses("src/adapters/node/b.ts", nodeImport)).toBe(true);
	});
});

// Runs the SQL plugins (lint/*.grit) on source text. Returns true when no plugin reports it.
function sqlRulePasses(source: string): boolean {
	const path = `src/core/sql-${Math.random().toString(36).slice(2)}.ts`;
	const file = join(sandbox, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, source);
	const result = spawnSync(biome, ["lint", "--vcs-enabled=false", path], {
		cwd: sandbox,
		encoding: "utf8",
	});
	return !`${result.stdout}${result.stderr}`.includes(" plugin ");
}

describe("lint rule: values never go into SQL text (input layer 3)", () => {
	const head =
		'declare const db: { prepare(s: string): unknown; exec(s: string): unknown };\nconst id = "1";\n';
	it.each([
		[
			"a template with a value in { sql }",
			"export const s = { sql: `SELECT * FROM t WHERE id = ${id}`, params: [] };",
		],
		[
			"concatenation in { sql }",
			'export const s = { sql: "SELECT * FROM t WHERE id = " + id, params: [] };',
		],
		["a template with a value in prepare()", "db.prepare(`SELECT ${id}`);"],
		["concatenation in exec()", 'db.exec("DELETE FROM t WHERE id = " + id);'],
	])("rejects %s", (_label, code) => {
		expect(sqlRulePasses(head + code)).toBe(false);
	});

	it.each([
		[
			"a bound parameter",
			'export const s = { sql: "SELECT * FROM t WHERE id = ?", params: [id] };',
		],
		["a template without values", "export const s = { sql: `SELECT 1`, params: [] };"],
		[
			"the sql tag",
			"declare function sql(s: TemplateStringsArray, ...v: unknown[]): unknown;\nexport const s = sql`SELECT * FROM t WHERE id = ${id}`;",
		],
		["a fixed prepare()", 'db.prepare("SELECT ?");'],
	])("allows %s", (_label, code) => {
		expect(sqlRulePasses(head + code)).toBe(true);
	});
});
