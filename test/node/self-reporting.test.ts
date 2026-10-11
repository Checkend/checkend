import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Rule: Checkend never reports its own errors to the same instance, because a failure
 * could then create more errors in a loop. Its own errors go to Workers Logs (console).
 */
describe("no self-reporting", () => {
	it("has no Sentry SDK in the runtime dependencies (SDKs are dev-only, for fixtures)", () => {
		const pkg = JSON.parse(readFileSync("package.json", "utf8"));
		const runtime = Object.keys(pkg.dependencies ?? {});
		expect(runtime.filter((name) => name.startsWith("@sentry/"))).toEqual([]);
	});

	it("does not import a Sentry SDK in the product code", () => {
		const files = readdirSync("src", { recursive: true, encoding: "utf8" })
			.filter((name) => name.endsWith(".ts"))
			.map((name) => join("src", name));
		expect(files.length).toBeGreaterThan(10);
		for (const file of files) {
			expect(readFileSync(file, "utf8"), file).not.toMatch(/from\s+["']@sentry\//);
		}
	});
});
