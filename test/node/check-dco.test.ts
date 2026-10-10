import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve(import.meta.dirname, "../../scripts/check-dco.sh");
let repo: string;

const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd: repo,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_AUTHOR_NAME: "Ada Lovelace",
			GIT_AUTHOR_EMAIL: "ada@example.com",
			GIT_COMMITTER_NAME: "Ada Lovelace",
			GIT_COMMITTER_EMAIL: "ada@example.com",
		},
	}).trim();

const commit = (message: string) => {
	git("commit", "--allow-empty", "-q", "-m", message);
	return git("rev-parse", "HEAD");
};

const checkDco = (range: string) =>
	spawnSync("bash", [script, range], { cwd: repo, encoding: "utf8" });

beforeEach(() => {
	repo = mkdtempSync(join(tmpdir(), "checkend-dco-"));
	git("init", "-q", "-b", "main");
	commit("Initial commit");
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

describe("scripts/check-dco.sh", () => {
	it("passes when every commit has the author's sign-off", () => {
		commit("Add a\n\nSigned-off-by: Ada Lovelace <ada@example.com>");
		commit("Add b\n\nBody.\n\nSigned-off-by: Ada Lovelace <ada@example.com>");
		const result = checkDco("HEAD~2..HEAD");
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});

	it("fails and names the commit without a sign-off", () => {
		commit("Add a\n\nSigned-off-by: Ada Lovelace <ada@example.com>");
		const bad = commit("Add b without sign-off");
		const result = checkDco("HEAD~2..HEAD");
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(bad.slice(0, 12));
		expect(result.stderr).toContain("git commit -s");
	});

	it("fails when the sign-off does not match the author", () => {
		commit("Add a\n\nSigned-off-by: Someone Else <else@example.com>");
		expect(checkDco("HEAD~1..HEAD").status).toBe(1);
	});

	it("passes for an empty range", () => {
		expect(checkDco("HEAD..HEAD").status).toBe(0);
	});
});
