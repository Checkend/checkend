import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const UI_DIR = "src/http/ui";

const files = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
	);

describe("output encoding rule", () => {
	it("has no way to write raw HTML in the UI (server or client)", () => {
		const sources = files(UI_DIR).filter((f) => f.endsWith(".ts"));
		expect(sources.length).toBeGreaterThan(5);
		for (const file of sources) {
			const source = readFileSync(file, "utf8")
				// Comments may name the forbidden APIs.
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/^\s*\/\/.*$/gm, "");
			expect(source, file).not.toMatch(/\braw\s*\(|import\s*\{[^}]*\braw\b/);
			expect(source, file).not.toMatch(
				/dangerouslySetInnerHTML|innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
			);
		}
	});
});
