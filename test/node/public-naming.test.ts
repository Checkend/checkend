import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The public repo does not name the hosted product or its host: hosted installs are a generic
 * feature here (a base path, a trusted front Worker). Examples use example hosts.
 */
const HOSTED_NAMES = /checkend[\s._-]*cloud|cloud\.checkend/i;

describe("public naming", () => {
	it("names no hosted product and no hosted host in tracked files", () => {
		const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
			.split("\0")
			.filter(
				(f) => f && !f.endsWith("package-lock.json") && f !== "test/node/public-naming.test.ts",
			);
		const found: string[] = [];
		for (const file of files) {
			let text: string;
			try {
				text = readFileSync(file, "utf8");
			} catch {
				continue;
			}
			text.split("\n").forEach((line, i) => {
				if (HOSTED_NAMES.test(line)) found.push(`${file}:${i + 1}`);
			});
		}
		expect(found).toEqual([]);
	});
});
