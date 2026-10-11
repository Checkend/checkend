import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Public files must not name internal planning codes (decision, hardening or review numbers such
 * as "D16", "H2" or "M3"): they mean nothing to readers of the open-source code. "D1" is the
 * Cloudflare database, so it is allowed.
 */
const CODE = /\b(D(?:[02-9]|[1-9]\d)|H\d|M\d|L\d)\b/;
const FOLDERS = [
	"src",
	"test",
	"scripts",
	"bench",
	"migrations",
	"spec",
	"lint",
	"skills",
	"examples",
];

describe("no internal planning codes in public files", () => {
	it("has none in the tracked source, tests, scripts and specs", () => {
		const files = execFileSync("git", ["ls-files", ...FOLDERS], { encoding: "utf8" })
			.split("\n")
			.filter(
				(f) =>
					/\.(ts|js|sql|md|jsonc?|ya?ml|grit)$/.test(f) && f !== "test/node/internal-codes.test.ts",
			);
		const hits = files.flatMap((file) =>
			readFileSync(file, "utf8")
				.split("\n")
				.flatMap((line, i) => (CODE.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])),
		);
		expect(hits).toEqual([]);
	});
});
