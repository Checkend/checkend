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

	it("is truthful about ce: not released, no npx line", () => {
		const text = installRecipe(BASE);
		expect(text).toContain("`ce` is not released yet");
		expect(text).not.toContain("npx");
		expect(text).toContain("go install github.com/Checkend/checkend-cli/cmd/ce@latest");
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
