import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Node runs the source with its built-in type stripping (scripts now, the Node entry later).
 * Type stripping does not support some TypeScript syntax, for example parameter properties
 * (`constructor(readonly x: string)`) and enums. This test imports the app and every core
 * module with plain Node.
 */
describe("Node type stripping", () => {
	it("imports the app and the scripts with plain node", () => {
		const code = [
			"await import('./src/http/app.ts');",
			"await import('./src/core/agent-docs.ts');",
			"await import('./src/adapters/node/sqlite-db.ts');",
			"await import('./src/adapters/node/migrations-fs.ts');",
			"console.log('ok');",
		].join("\n");
		const result = spawnSync("node", ["--input-type=module", "-e", code], { encoding: "utf8" });
		expect(result.stderr).not.toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|SyntaxError/);
		expect(result.stdout.trim()).toBe("ok");
	});

	it("runs npm run skill:build", () => {
		const result = spawnSync("node", ["scripts/build-skill.ts"], { encoding: "utf8" });
		expect(result.status, result.stderr).toBe(0);
	});
});
