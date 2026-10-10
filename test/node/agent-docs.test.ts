import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { llmsTxt, skillFile } from "../../src/core/agent-docs.ts";
import { UNTRUSTED_NOTICE } from "../../src/core/brief.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

const BASE = "https://errors.example.com";

describe("llms.txt and the agent skill file", () => {
	it.each([
		["llms.txt", llmsTxt(BASE)],
		["SKILL.md", skillFile(BASE)],
	])(
		"%s names the MCP endpoint, every tool, the token scope and the untrusted-data warning",
		(_name, text) => {
			expect(text).toContain(`${BASE}/mcp`);
			for (const tool of ["list_issues", "get_issue_brief", "get_event"])
				expect(text).toContain(tool);
			expect(text).toContain("issues:read");
			expect(text).toContain(UNTRUSTED_NOTICE);
		},
	);

	it("llms.txt lists every /v1 route of the app", async () => {
		const app = createApp({ state: new IngestState() });
		const routes = app.routes
			.filter((r) => r.path.startsWith("/v1/") && r.method !== "ALL")
			.map((r) => `${r.method} ${r.path}`);
		const text = llmsTxt(BASE);
		for (const route of new Set(routes)) expect(text, route).toContain(route);
	});

	it("SKILL.md has the skill front matter", () => {
		expect(skillFile(BASE)).toMatch(/^---\nname: checkend\ndescription: .+\n---\n/);
	});

	it("the skill file in the repository matches the generated one", () => {
		expect(readFileSync("skills/checkend/SKILL.md", "utf8")).toBe(
			skillFile("https://<your-checkend>"),
		);
	});

	it("serves /llms.txt and /skill.md without a token, with this instance's URL", async () => {
		const t = await testPorts();
		const app = createApp({ state: new IngestState() });
		for (const [path, type] of [
			["/llms.txt", "text/plain"],
			["/skill.md", "text/markdown"],
		] as const) {
			const response = await app.request(`https://checkend.example${path}`, {}, { ports: t.ports });
			expect(response.status, path).toBe(200);
			expect(response.headers.get("content-type"), path).toContain(type);
			expect(await response.text(), path).toContain("https://checkend.example/mcp");
		}
	});
});
