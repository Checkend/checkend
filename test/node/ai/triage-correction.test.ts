import { describe, expect, it } from "vitest";
import { correctTriage, triageIssue } from "../../../src/core/ai/triage.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { listLabels } from "../../../src/core/labels.ts";
import { createProject } from "../../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../../src/core/tokens.ts";
import { createApp } from "../../../src/http/app.ts";
import { sql } from "../../../src/ports/db.ts";
import { fakeClef } from "../../support/fake-clef.ts";
import { testPorts } from "../../support/node-ports.ts";

async function setup() {
	const clef = fakeClef();
	const t = await testPorts({
		models: clef.runner,
		config: { adminToken: "admin-token-test-0123456789" },
	});
	const ports = {
		...t.ports,
		config: { ...t.ports.config, ai: { ...t.ports.config.ai, triage: true } },
	};
	const project = await createProject(ports, { name: "Shop" });
	await storeEvent(
		ports,
		new IngestState(),
		project.internalId,
		await prepareEvent(new TextEncoder().encode('{"message":"x"}'), t.clock.now()),
	);
	const issueId = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
	return { ...t, ports, issueId };
}

describe("triage corrections", () => {
	it("records the correction with the model answer of that time, as a label", async () => {
		const { ports, issueId, clock } = await setup();
		await triageIssue(ports, issueId);
		expect(
			await correctTriage(ports, BOOTSTRAP_ADMIN, issueId, {
				category: "infrastructure",
				noise: false,
				note: "DB timeout",
			}),
		).toBe("ok");
		const labels = await listLabels(ports.db, { limit: 10 }, clock.now());
		expect(labels).toEqual([
			expect.objectContaining({
				issue_id: issueId,
				label: "triage_corrected",
				corrects: "triage",
				actor_type: "admin_token",
				data: {
					corrected: { category: "infrastructure", noise: false },
					note: "DB timeout",
					model: "clef-flash",
					version: 1,
					model_answer: { category: "code_bug", noise: 0.1 },
				},
			}),
		]);
	});

	it("works without a model triage, and rejects an empty correction or an unknown issue", async () => {
		const { ports, issueId } = await setup();
		expect(await correctTriage(ports, BOOTSTRAP_ADMIN, issueId, { severity: 3 })).toBe("ok");
		expect(await correctTriage(ports, BOOTSTRAP_ADMIN, 999, { severity: 3 })).toBe("not_found");
		const row = await ports.db.first<{ data: string }>(
			sql`SELECT data FROM activity WHERE action = 'issue.triage_correct'`,
		);
		expect(JSON.parse(row?.data ?? "{}")).toEqual({
			corrected: { severity: 3 },
			model: null,
			version: null,
			model_answer: null,
		});
	});

	it("REST: POST /v1/issues/:id/triage-correction needs issues:write and a valid body", async () => {
		const { ports, issueId } = await setup();
		const app = createApp({ state: new IngestState() });
		const read = (await createToken(ports, BOOTSTRAP_ADMIN, { name: "r", scopes: ["issues:read"] }))
			.token;
		const write = (
			await createToken(ports, BOOTSTRAP_ADMIN, { name: "w", scopes: ["issues:write"] })
		).token;
		const post = (token: string, body: unknown, id = issueId) =>
			app.request(
				`/v1/issues/${id}/triage-correction`,
				{
					method: "POST",
					headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
					body: JSON.stringify(body),
				},
				{ ports },
			);
		expect((await post(read, { severity: 1 })).status).toBe(403);
		expect((await post(write, {})).status).toBe(400);
		expect((await post(write, { category: "delete_everything" })).status).toBe(400);
		expect((await post(write, { severity: 7 })).status).toBe(400);
		expect((await post(write, { severity: 1 }, 999)).status).toBe(404);
		expect((await post(write, { transient: true })).status).toBe(201);
	});
});
