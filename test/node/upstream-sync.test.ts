import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { compareReleases, newestRelease, syncRelease } from "../../scripts/upstream-sync.ts";

const git = (cwd: string, ...args: string[]) =>
	execFileSync(
		"git",
		[
			"-c",
			"user.name=test",
			"-c",
			"user.email=test@example.com",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{
			cwd,
			encoding: "utf8",
		},
	);

describe("release tags", () => {
	it("compares v0.N and v0.N.M numerically, and picks the newest newer release", () => {
		expect(compareReleases("v0.10", "v0.9")).toBeGreaterThan(0);
		expect(compareReleases("v0.8", "v0.8.0")).toBe(0);
		expect(newestRelease(["v0.8", "v0.9.1", "v0.10", "v-rails-final", "v1.0-rc1"], "v0.8")).toBe(
			"v0.10",
		);
		expect(newestRelease(["v0.8"], "v0.8")).toBeNull();
	});
});

describe("syncRelease (temporary git repositories)", () => {
	beforeEach(() => {
		vi.stubEnv("GIT_AUTHOR_NAME", "test");
		vi.stubEnv("GIT_AUTHOR_EMAIL", "test@example.com");
		vi.stubEnv("GIT_COMMITTER_NAME", "test");
		vi.stubEnv("GIT_COMMITTER_EMAIL", "test@example.com");
	});

	const setup = () => {
		const root = mkdtempSync(join(tmpdir(), "checkend-sync-"));
		const upstream = join(root, "upstream");
		const copy = join(root, "copy");
		execFileSync("git", ["init", "--quiet", "-b", "main", upstream]);
		writeFileSync(join(upstream, "app.ts"), "export const a = 1;\n");
		writeFileSync(join(upstream, "wrangler.jsonc"), '{ "name": "checkend" }\n');
		git(upstream, "add", ".");
		git(upstream, "commit", "--quiet", "-m", "v0.8");
		git(upstream, "tag", "v0.8");
		// The copy: a fresh history (like the deploy button), with its own Worker name.
		execFileSync("git", ["init", "--quiet", "-b", "main", copy]);
		writeFileSync(join(copy, "app.ts"), "export const a = 1;\n");
		writeFileSync(join(copy, "wrangler.jsonc"), '{ "name": "my-errors" }\n');
		git(copy, "add", ".");
		git(copy, "commit", "--quiet", "-m", "initial");
		execFileSync("git", ["init", "--quiet", "--bare", join(root, "origin.git")]);
		git(copy, "remote", "add", "origin", join(root, "origin.git"));
		return { upstream, copy };
	};

	it("applies the upstream changes on a new branch and keeps the copy's own changes", () => {
		const { upstream, copy } = setup();
		writeFileSync(join(upstream, "app.ts"), "export const a = 2;\n");
		writeFileSync(join(upstream, "new.ts"), "export const b = 1;\n");
		git(upstream, "add", ".");
		git(upstream, "commit", "--quiet", "-m", "v0.9");
		git(upstream, "tag", "v0.9");
		expect(syncRelease({ cwd: copy, upstream, base: "v0.8" })).toEqual({
			kind: "proposed",
			branch: "checkend-upstream/v0.9",
			from: "v0.8",
			to: "v0.9",
		});
		expect(readFileSync(join(copy, "app.ts"), "utf8")).toBe("export const a = 2;\n");
		expect(readFileSync(join(copy, "new.ts"), "utf8")).toBe("export const b = 1;\n");
		expect(readFileSync(join(copy, "wrangler.jsonc"), "utf8")).toContain("my-errors");
		expect(git(copy, "log", "-1", "--format=%s")).toBe("Update Checkend from v0.8 to v0.9\n");
		// Again: the branch exists, so nothing new.
		git(copy, "switch", "--quiet", "main");
		expect(syncRelease({ cwd: copy, upstream, base: "v0.8" })).toEqual({
			kind: "branch_exists",
			branch: "checkend-upstream/v0.9",
		});
	});

	it("says up to date, refuses a base that is not a release, and reports a conflict", () => {
		const { upstream, copy } = setup();
		expect(syncRelease({ cwd: copy, upstream, base: "v0.8" })).toEqual({ kind: "up_to_date" });
		expect(() => syncRelease({ cwd: copy, upstream, base: "main; rm -rf /" })).toThrow(
			/not a release/,
		);
		expect(() => syncRelease({ cwd: copy, upstream, base: "v0.7" })).toThrow(/no tag v0.7/);
		writeFileSync(join(upstream, "app.ts"), "export const a = 3;\n");
		git(upstream, "commit", "--quiet", "-am", "v0.9");
		git(upstream, "tag", "v0.9");
		writeFileSync(join(copy, "app.ts"), "export const a = 99; // local change\n");
		git(copy, "commit", "--quiet", "-am", "local");
		expect(syncRelease({ cwd: copy, upstream, base: "v0.8" })).toMatchObject({
			kind: "conflict",
			to: "v0.9",
		});
	});
});

describe("the Upstream sync workflow", () => {
	const text = readFileSync(".github/workflows/upstream-sync.yml", "utf8");

	it("has least privilege: no global permissions, only contents and pull requests in the job", () => {
		expect(text).toContain("permissions: {}");
		expect(text).toMatch(/permissions:\n\s+contents: write\n\s+pull-requests: write\n/);
		expect(text.match(/permissions:/g)).toHaveLength(2);
	});

	it("pins every action to a commit, never runs in the upstream repository, and puts no expression into a script", () => {
		for (const [, ref] of text.matchAll(/uses: [^@\s]+@(\S+)/g))
			expect(ref).toMatch(/^[0-9a-f]{40}$/);
		expect(text).toContain("if: github.repository != 'Checkend/checkend'");
		const scripts = [...text.matchAll(/run: \|\n((?:\s{10}.*\n?)+)/g)].map((m) => m[1] ?? "");
		expect(scripts.length).toBe(2);
		for (const script of scripts) expect(script).not.toContain("${{");
	});
});
