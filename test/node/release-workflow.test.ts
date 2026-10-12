import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The server release workflow (.github/workflows/release.yml). A published release is never
 * unsigned: the sign job verifies the signature with release/allowed_signers before it publishes.
 * Text checks: the repo has no YAML parser.
 */
const text = readFileSync(".github/workflows/release.yml", "utf8");

/** The text of one job, up to the next job. */
const job = (name: string) => {
	const start = text.indexOf(`\n  ${name}:\n`);
	expect(start, name).toBeGreaterThan(0);
	const rest = text.slice(start + 1);
	const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
	return next < 0 ? rest : rest.slice(0, next + 1);
};

describe("the release workflow", () => {
	it("runs only for a version tag, and replaces the old image workflow", () => {
		expect(text).toMatch(/on:\n {2}push:\n {4}tags: \["v\*\.\*\.\*"\]\n/);
		expect(text).not.toMatch(/^ {2}(pull_request|pull_request_target|workflow_run):/m);
		expect(existsSync(".github/workflows/release-image.yml")).toBe(false);
	});

	it("has read-only defaults, pinned actions and no stored credentials", () => {
		expect(text).toMatch(/^permissions:\n {2}contents: read\n/m);
		for (const use of text.matchAll(/uses: (\S+)/g)) {
			expect(use[1], use[1]).toMatch(/@[0-9a-f]{40}$/);
		}
		const checkouts = text.match(/actions\/checkout@/g) ?? [];
		const noCredentials = text.match(/persist-credentials: false/g) ?? [];
		expect(noCredentials.length).toBe(checkouts.length);
	});

	it("builds without the signing key: check, image and draft release", () => {
		for (const name of ["check", "image", "build"]) {
			expect(job(name), name).not.toContain("SERVER_RELEASE_SIGNING_KEY");
			expect(job(name), name).not.toContain("environment:");
		}
		expect(job("check")).toContain("npm run check");
		expect(job("image")).toContain("packages: write");
		expect(job("image")).toContain("platforms: linux/amd64,linux/arm64");
		const build = job("build");
		expect(build).toContain("wrangler deploy --dry-run --outdir dist");
		expect(build).toContain("docker buildx imagetools inspect");
		expect(build).toContain("node scripts/release-manifest.ts");
		expect(build).toContain("SHA256SUMS");
		expect(build).toMatch(/gh release create [^\n]*--draft/);
		expect(build).not.toContain("checkend-release.json.sig");
	});

	it("signs in the release environment, removes the key, verifies, then publishes", () => {
		const sign = job("sign");
		expect(sign).toContain("needs: build");
		expect(sign).toContain("environment: release");
		expect(sign).toMatch(/permissions:\n {6}contents: write/);
		const order = [
			"gh release download",
			"set +x",
			"umask 077",
			'ssh-keygen -Y sign -q -f "$RUNNER_TEMP/server-release-key" -n checkend-server-release checkend-release.json',
			"if: always()",
			"ssh-keygen -Y verify -f release/allowed_signers -I server-2026 -n checkend-server-release",
			"gh release upload",
			"--draft=false",
		].map((part) => {
			const at = sign.indexOf(part);
			expect(at, part).toBeGreaterThan(0);
			return at;
		});
		expect(order).toEqual([...order].sort((a, b) => a - b));
		expect(sign).toContain("SIGNING_KEY: ${{ secrets.SERVER_RELEASE_SIGNING_KEY }}");
		expect(text).not.toMatch(/run:[^\n]*\$\{\{\s*secrets\./);
	});
});
