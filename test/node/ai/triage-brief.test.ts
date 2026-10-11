import { describe, expect, it } from "vitest";
import { triageIssue } from "../../../src/core/ai/triage.ts";
import { buildBrief } from "../../../src/core/brief.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject } from "../../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../../src/core/tokens.ts";
import { createApp } from "../../../src/http/app.ts";
import { sql } from "../../../src/ports/db.ts";
import { expectSpecBrief } from "../../support/brief-check.ts";
import { fakeClef } from "../../support/fake-clef.ts";
import { testPorts } from "../../support/node-ports.ts";

async function setup(triage: boolean) {
	const clef = fakeClef();
	const t = await testPorts({
		models: clef.runner,
		config: { adminToken: "admin-token-0123456789abcdef" },
	});
	const ports = { ...t.ports, config: { ...t.ports.config, ai: { ...t.ports.config.ai, triage } } };
	const project = await createProject(ports, { name: "Shop" });
	const prepared = await prepareEvent(
		new TextEncoder().encode('{"message":"TypeError: x is undefined"}'),
		t.clock.now(),
	);
	await storeEvent(ports, new IngestState(), project.internalId, prepared);
	const issueId = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
	return { ...t, ports, clef, issueId };
}

describe("triage in the brief", () => {
	it("has no triage section when the issue has no triage", async () => {
		const { ports, issueId } = await setup(false);
		const brief = await buildBrief(ports.db, issueId, ports.clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.triage).toBeNull();
		expect(brief?.markdown).not.toContain("Triage");
	});

	it("shows the stored answers as model advice, in the JSON and the Markdown", async () => {
		const { ports, issueId } = await setup(true);
		await triageIssue(ports, issueId);
		const brief = await buildBrief(ports.db, issueId, ports.clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.triage).toEqual({
			notice: expect.stringContaining("advice"),
			model: "clef-flash",
			version: 1,
			triaged_at: "2026-10-10T12:00:00.000Z",
			category: {
				label: "code_bug",
				confidence: 0.9,
				probabilities: expect.objectContaining({ code_bug: 0.9, other: 0.02 }),
			},
			severity: {
				score: 2.2,
				level: "Major: an important feature fails for some users",
				confidence: 0.8,
			},
			p_transient: 0.7,
			p_agent_fixable: 0.7,
			p_noise: 0.1,
		});
		expect(brief?.markdown).toContain("## Triage (model advice)");
		expect(brief?.markdown).toContain("| Cause | code_bug (p 0.90) |");
		expect(brief?.markdown).toContain("| Noise | p 0.10 |");
	});
});

describe("a brief request triages the issue", () => {
	const brief = async (ports: Awaited<ReturnType<typeof setup>>["ports"], issueId: number) => {
		const token = (
			await createToken(ports, BOOTSTRAP_ADMIN, { name: "r", scopes: ["issues:read"] })
		).token;
		const app = createApp({ state: new IngestState() });
		const call = (id: number, body: unknown) =>
			app.request(
				new Request("http://x/mcp", {
					method: "POST",
					headers: {
						authorization: `Bearer ${token}`,
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
					},
					body: JSON.stringify({ jsonrpc: "2.0", id, ...(body as object) }),
				}),
				undefined,
				{ ports },
			);
		await call(1, {
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "t", version: "1" },
			},
		});
		const response = await call(2, {
			method: "tools/call",
			params: { name: "get_issue_brief", arguments: { issue_id: issueId, format: "json" } },
		});
		const text = await response.text();
		return text;
	};

	it("with AI_TRIAGE on: the first brief triages the issue once, even below 3 events", async () => {
		const { ports, issueId, clef } = await setup(true);
		expect(await brief(ports, issueId)).toContain("clef-flash");
		await brief(ports, issueId);
		expect(clef.calls).toHaveLength(1);
	});

	it("with AI_TRIAGE off: no model call", async () => {
		const { ports, issueId, clef } = await setup(false);
		await brief(ports, issueId);
		expect(clef.calls).toHaveLength(0);
	});
});
