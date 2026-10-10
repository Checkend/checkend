import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("examples/github-actions/checkend-agent.yml", "utf8");
const lines = workflow.split("\n").filter((line) => !line.trimStart().startsWith("#"));
const code = lines.join("\n");

/** The text of a job (from "  <name>:" to the next job). */
const job = (name: string) => {
	const start = code.indexOf(`\n  ${name}:\n`);
	if (start < 0) return "";
	const next = code.slice(start + 1).search(/\n {2}[a-z][a-z0-9_-]*:\n/);
	return next < 0 ? code.slice(start) : code.slice(start, start + 1 + next);
};
/** The steps of a job, each as its text. */
const steps = (jobText: string) => jobText.split(/\n {6}- name: /).slice(1);
const step = (jobText: string, name: string) =>
	steps(jobText).find((s) => s.startsWith(name)) ?? "";
/** The permissions block of a job. */
const permissions = (jobText: string) =>
	`${jobText}\n`.match(/\n {4}permissions:\n((?: {6}.+\n)+)/)?.[1];

const agent = job("agent");
const pr = job("pr");
const TOKEN = /GH_TOKEN|GITHUB_TOKEN|github\.token/;
/** Commands that run code from the repository (or from the patch). */
const REPO_CODE = /\b(npm|npx|node|yarn|pnpm|make|bash \.\/|sh \.\/|\.\/[a-z])/;

describe("the GitHub Actions example (least privilege)", () => {
	it("starts only on Checkend dispatches, never on pull_request_target", () => {
		expect(code).toMatch(
			/on:\n {2}repository_dispatch:\n {4}types: \[checkend\.issue\.new, checkend\.issue\.regressed\]/,
		);
		expect(code).not.toMatch(/pull_request_target|workflow_run|push:/);
	});

	it("has no default permissions; the agent job can only read; the pr job writes", () => {
		expect(code).toMatch(/^permissions: \{\}$/m);
		expect(agent).not.toBe("");
		expect(pr).not.toBe("");
		expect(permissions(agent)).toBe("      contents: read\n");
		expect(permissions(pr)).toBe("      contents: write\n      pull-requests: write\n");
		expect(code).not.toMatch(/workflows: write|id-token|actions: write/);
		expect(pr).toMatch(/\n {4}needs: agent\n/);
	});

	it("puts untrusted payload values only in env, never in a shell command", () => {
		for (const line of lines.filter((l) => l.includes("client_payload"))) {
			const allowed =
				/^ {10}[A-Z_]+: \$\{\{ github\.event\.client_payload\.[a-z_.]+ \}\}$/.test(line) ||
				/^ {2}group: checkend-issue-\$\{\{ github\.event\.client_payload\.issue\.id \}\}$/.test(
					line,
				) ||
				/^ {4}if: github\.event\.client_payload\.issue\.trust == 'high'$/.test(line);
			expect(allowed, line).toBe(true);
		}
	});

	it("gives the agent job no GitHub token and only the model key", () => {
		expect(step(agent, "Check out")).toContain("persist-credentials: false");
		expect(agent).not.toMatch(TOKEN);
		expect([...agent.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])).toEqual([
			"ANTHROPIC_API_KEY",
		]);
		expect(step(agent, "Run the agent")).toContain("UNTRUSTED blocks");
		expect(agent).not.toMatch(/git (commit|push)/);
	});

	it("never runs repository code in a job that has a write token", () => {
		expect(pr).toMatch(TOKEN);
		for (const s of steps(pr)) {
			const run = s.split(/\n {8}run: \|\n/)[1] ?? "";
			expect(REPO_CODE.test(run), s.split("\n")[0]).toBe(false);
		}
		expect(step(pr, "Check out")).toContain("persist-credentials: false");
	});

	it("checks the patch before it applies it: no .github/, .git, symlinks or paths outside", () => {
		const check = step(pr, "Check the patch");
		expect(check).toContain("git apply --check");
		expect(check).toMatch(/\\\.github\//);
		expect(check).toMatch(/\\\.git\//);
		expect(check).toContain("120000");
		expect(check).toContain("(^|/)\\.\\.(/|$)");
		const order = steps(pr).map((s) => s.split("\n")[0]);
		expect(order.indexOf("Check the patch")).toBeLessThan(
			order.indexOf("Open a draft pull request"),
		);
	});

	it("commits and pushes with git hooks off, and opens a draft without auto-merge", () => {
		const open = step(pr, "Open a draft pull request");
		for (const command of open.match(/git [^\n]*\b(commit|push)\b[^\n]*/g) ?? []) {
			expect(command).toContain("-c core.hooksPath=/dev/null");
		}
		expect(open).toMatch(/commit[^\n]*--no-verify/);
		expect(open).toContain("gh pr create --draft");
		expect(code).not.toMatch(/--auto|gh pr merge|auto-merge/);
	});

	it("pins every action to a commit SHA, and the agent version", () => {
		const uses = [...code.matchAll(/uses: ([^\s]+)/g)].map((m) => m[1] ?? "");
		expect(uses.length).toBeGreaterThan(0);
		for (const action of uses) expect(action, action).toMatch(/@[0-9a-f]{40}$/);
		expect(agent).toMatch(/@anthropic-ai\/claude-code@\d+\.\d+\.\d+/);
	});
});
