import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflow = readFileSync("examples/github-actions/checkend-agent.yml", "utf8");
const lines = workflow.split("\n").filter((line) => !line.trimStart().startsWith("#"));
const code = lines.join("\n");

/** The steps, each as its text. */
const steps = code.split(/\n {6}- name: /).slice(1);
const step = (name: string) => steps.find((s) => s.startsWith(name)) ?? "";

describe("the GitHub Actions example (least privilege)", () => {
	it("starts only on Checkend dispatches, never on pull_request_target", () => {
		expect(code).toMatch(
			/on:\n {2}repository_dispatch:\n {4}types: \[checkend\.issue\.new, checkend\.issue\.regressed\]/,
		);
		expect(code).not.toMatch(/pull_request_target|workflow_run|push:/);
	});

	it("asks for contents and pull-requests write only", () => {
		const permissions = /^permissions:\n((?: {2}.+\n)+)/m.exec(code)?.[1];
		expect(permissions).toBe("  contents: write\n  pull-requests: write\n");
		expect(code.match(/permissions:/g)).toHaveLength(1);
		expect(code).not.toMatch(/workflows: write|id-token|actions: write/);
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

	it("gives the agent no GitHub token and only the model key", () => {
		expect(step("Check out")).toContain("persist-credentials: false");
		const agent = step("Run the agent");
		expect(agent.match(/\$\{\{[^}]*\}\}/g)).toEqual(["${{ secrets.ANTHROPIC_API_KEY }}"]);
		expect(agent).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|github\.token/);
		expect(agent).toContain("UNTRUSTED blocks");
		const secrets = [...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
		expect([...new Set(secrets)].sort()).toEqual(["ANTHROPIC_API_KEY", "CHECKEND_TOKEN"]);
	});

	it("stops on .github/ changes, and opens a draft without auto-merge", () => {
		const order = steps.map((s) => s.split("\n")[0]);
		expect(order.indexOf("Stop when the agent changed .github/")).toBeLessThan(
			order.indexOf("Open a draft pull request"),
		);
		expect(step("Open a draft pull request")).toContain("gh pr create --draft");
		expect(code).not.toMatch(/--auto|gh pr merge|auto-merge/);
	});
});
