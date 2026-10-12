import { describe, expect, it } from "vitest";
import { API_ROUTES } from "../../../src/core/api-spec.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { AGENT_TASKS, installRecipe, setupRecipe, taskRecipe } from "../../../src/core/recipes.ts";
import { createApp } from "../../../src/http/app.ts";
import { testPorts } from "../../support/node-ports.ts";

const BASE = "https://errors.example.com";
const all = () => [
	installRecipe(BASE),
	setupRecipe(BASE),
	...AGENT_TASKS.map((t) => taskRecipe(BASE, t.task) ?? ""),
];

describe("the agent recipes", () => {
	it("has a recipe for each task of the UI menu", () => {
		expect(AGENT_TASKS.map((t) => t.task)).toEqual([
			"sourcemaps",
			"deploys",
			"migrate-from-sentry",
			"environments",
			"rotate-dsn",
			"fix-top-issue",
			"delete-project",
			"remove",
		]);
		for (const task of AGENT_TASKS) {
			const text = taskRecipe(BASE, task.task);
			expect(text, task.task).toContain(`# ${task.title}`);
			if (task.command) expect(text, task.task).toContain(task.command);
		}
		expect(taskRecipe(BASE, "../etc/passwd")).toBeNull();
	});

	it("the fallback never puts a key or a token into a command: only environment variables", () => {
		for (const text of all()) {
			for (const [, value] of text.matchAll(/Bearer\s+(\S+)/g)) {
				expect(value, text.slice(0, 60)).toMatch(
					/^\$\{?CHECKEND_(SETUP_KEY|TOKEN|DEPLOY_TOKEN|ADMIN_TOKEN)\}?/,
				);
			}
			expect(text).not.toMatch(/--key\s/);
		}
		expect(setupRecipe(BASE)).toContain("## If ce is not available (fallback)");
		for (const task of AGENT_TASKS.filter((t) => t.command)) {
			expect(taskRecipe(BASE, task.task), task.task).toContain("## If ce is not available");
		}
	});

	it("is truthful about ce: the published channels, the install script first, no npx line", () => {
		const text = installRecipe(BASE);
		const script =
			"curl -fsSL https://raw.githubusercontent.com/Checkend/checkend-cli/main/install.sh | sh";
		expect(text).toContain(script);
		expect(text).toContain("npm install -g @checkend/cli");
		expect(text).toContain("brew tap checkend/tap\nbrew install checkend/tap/checkend");
		expect(text).toContain("Go 1.26 or later");
		expect(text).toContain("go install github.com/Checkend/checkend-cli/cmd/ce@latest");
		expect(text.indexOf(script)).toBeLessThan(text.indexOf("npm install"));
		expect(text.indexOf("npm install")).toBeLessThan(text.indexOf("go install"));
		expect(text).not.toMatch(/not available yet|not published/);
		expect(text).not.toContain("npx");
	});

	it("finds ce after go install when the Go bin folder is not on PATH", () => {
		const text = installRecipe(BASE);
		const after = text.slice(text.indexOf("go install"));
		expect(after).toContain("ce --version");
		expect(after).toContain('"$(go env GOPATH)/bin/ce"');
		expect(after).toContain(`export PATH="$PATH:$(go env GOPATH)/bin"`);
		expect(after).toContain("~/.zshrc");
		expect(after).toContain("~/.bashrc");
	});

	it("asks the human for a releases:write token from Settings → Tokens for the CI secret", () => {
		for (const task of ["deploys", "sourcemaps"]) {
			const text = taskRecipe(BASE, task) ?? "";
			expect(text, task).toContain(
				"Ask the human to create a token with releases:write for this app in Settings → Tokens, and to add it to the CI secret CHECKEND_DEPLOY_TOKEN.",
			);
			expect(text, task).toContain("Do not create it yourself.");
			expect(text, task).not.toContain("CHECKEND_ADMIN_TOKEN");
		}
	});

	it("the rules and the prompt agree: the key goes to ce only in CHECKEND_SETUP_KEY, never as an argument", () => {
		const install = installRecipe(BASE);
		expect(install).toContain(
			"Pass it to `ce` only in the environment variable `CHECKEND_SETUP_KEY`: never as an argument (`--key`)",
		);
		const setup = setupRecipe(BASE);
		expect(setup).not.toMatch(/CHECKEND_SETUP_KEY=cks/);
		expect(setup).not.toMatch(/--key\s+cks/);
	});

	it("connects MCP with the full path of ce when the Go bin folder is not on PATH", () => {
		const setup = setupRecipe(BASE);
		const mcp = setup.slice(setup.indexOf("## 7. Connect MCP"));
		expect(mcp).toContain(`claude mcp add checkend -- "$(go env GOPATH)/bin/ce" mcp --url ${BASE}`);
		expect(mcp).toContain(`codex mcp add checkend -- "$(go env GOPATH)/bin/ce" mcp --url ${BASE}`);
		expect(mcp).toContain("ce --version");
		expect(mcp).toContain('echo "$(go env GOPATH)/bin/ce"');
	});

	it("contains no secrets: no keys, no tokens, no DSN with a key", () => {
		for (const text of all()) {
			expect(text).not.toMatch(/cks_[A-Za-z0-9_-]{8}|ck_[A-Za-z0-9_-]{8}|[0-9a-f]{32}@/);
		}
	});

	it("names only routes and recipes that exist", () => {
		const routes = new Set(API_ROUTES.map((r) => r.path.replace(/:\w+/g, "<x>")));
		for (const text of all()) {
			for (const [, method, path] of text.matchAll(
				/(GET|POST|DELETE) https:\/\/errors\.example\.com(\/v1\/[^\s?`]+?)\.?(?=[\s?`]|$)/g,
			)) {
				expect(routes, `${method} ${path}`).toContain(path?.replace(/<[^>]+>/g, "<x>"));
			}
			for (const [, task] of text.matchAll(/\/agent\/tasks\/([a-z-]+)\.md/g)) {
				expect(taskRecipe(BASE, task ?? ""), task).not.toBeNull();
			}
		}
	});

	it("connects MCP through ce mcp, so the token stays in the keychain", () => {
		const text = setupRecipe(BASE);
		expect(text).toContain(`claude mcp add checkend -- ce mcp --url ${BASE}`);
		expect(text).toContain(`codex mcp add checkend -- ce mcp --url ${BASE}`);
		expect(text).toContain('"command": "ce"');
		// The HTTP form with a bearer token is only the fallback, after the ce form.
		expect(text.indexOf("Authorization: Bearer")).toBeGreaterThan(
			text.indexOf("## If ce is not available"),
		);
		expect(text.indexOf("## If ce is not available")).toBeGreaterThan(text.indexOf("ce mcp --url"));
	});

	it("the setup recipe covers each step of the design", () => {
		const text = setupRecipe(BASE);
		for (const step of [
			"ce setup --url",
			"Sentry SDK",
			"environment variable",
			"release",
			"environment",
			"test error",
			"ce mcp",
			"deploys.md",
			"sourcemaps.md",
			"skill.md",
			"one commit or pull request",
		]) {
			expect(text, step).toContain(step);
		}
	});

	it("is served as Markdown without a token, from the URL of the request", async () => {
		const { ports } = await testPorts();
		const app = createApp({ state: new IngestState() });
		for (const path of ["/agent/install", "/agent/setup.md", "/agent/tasks/deploys.md"]) {
			const response = await app.request(`https://errors.example.com${path}`, {}, { ports });
			expect(response.status, path).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/markdown");
			expect(await response.text()).toContain(BASE);
		}
		expect(
			(await app.request("https://errors.example.com/agent/tasks/nope.md", {}, { ports })).status,
		).toBe(404);
	});
});
