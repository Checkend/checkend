import { describe, expect, it } from "vitest";
import { sqliteVectorIndex } from "../../../src/adapters/node/vector-index.ts";
import { runEmbeddings } from "../../../src/core/ai/similar.ts";
import { runTriage } from "../../../src/core/ai/triage.ts";
import { buildBrief } from "../../../src/core/brief.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { getIssue, listIssues } from "../../../src/core/issues.ts";
import { createProject, listProjects } from "../../../src/core/projects.ts";
import { registerApp, sendTestEvent } from "../../../src/core/setup.ts";
import { authenticateSetupKey, createSetupKey } from "../../../src/core/setup-keys.ts";
import { onboardingProgress } from "../../../src/core/setup-progress.ts";
import { BOOTSTRAP_ADMIN } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { expectSpecBrief } from "../../support/brief-check.ts";
import { fakeClef } from "../../support/fake-clef.ts";
import { fakeEmbeddings } from "../../support/fake-embeddings.ts";
import { testPorts } from "../../support/node-ports.ts";

async function withTestEvent() {
	const t = await testPorts();
	const key = await createSetupKey(t.ports, BOOTSTRAP_ADMIN);
	const actor = await authenticateSetupKey(t.ports, `Bearer ${key.key}`);
	if (!actor) throw new Error();
	const app = await registerApp(t.ports, actor, { name: "shop-api" });
	if (!app.ok) throw new Error();
	const now = t.clock.now().toISOString();
	await t.ports.db.run(
		sql`INSERT INTO webhooks (uid, name, url, secret, events, created_at, created_by)
			VALUES ('w1', 'hook', 'https://hooks.example/x', 'secret-for-test', '["issue.new","issue.spike"]', ${now}, 'test')`,
	);
	await sendTestEvent(t.ports, new IngestState(), actor, app.project.slug);
	const issueId = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
	return { ...t, app, issueId };
}

describe("the setup test event", () => {
	it("makes a resolved test issue, with no counts, no alerts and no webhooks", async () => {
		const { ports, issueId } = await withTestEvent();
		expect(await ports.db.first(sql`SELECT test, status, users_affected FROM issues`)).toEqual({
			test: 1,
			status: "resolved",
			users_affected: 0,
		});
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM issue_counts`)).toEqual({ n: 0 });
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM webhook_deliveries`)).toEqual({
			n: 0,
		});
		expect(
			await ports.db.first(sql`SELECT count(*) AS n FROM events WHERE issue_id = ${issueId}`),
		).toEqual({ n: 1 });
	});

	it("is left out of the issue list, unless the filter test=true asks for it", async () => {
		const { ports, clock, issueId } = await withTestEvent();
		const all = await listIssues(
			ports.db,
			{ limit: 25, status: "resolved" } as never,
			null,
			clock.now(),
		);
		expect(typeof all === "string" ? all : all.data).toEqual([]);
		const tests = await listIssues(
			ports.db,
			{ limit: 25, status: "resolved", test: "true" } as never,
			null,
			clock.now(),
		);
		expect(typeof tests === "string" ? tests : tests.data.map((i) => [i.id, i.test])).toEqual([
			[issueId, true],
		]);
	});

	it("stays visible by ID and in the brief, with a clear note", async () => {
		const { ports, clock, issueId } = await withTestEvent();
		expect(await getIssue(ports.db, issueId, clock.now())).toMatchObject({
			test: true,
			events_24h: 0,
		});
		const brief = await buildBrief(ports.db, issueId, clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.issue.test).toBe(true);
		expect(brief?.markdown).toContain("Test event from setup");
	});

	it("does not count for the project, but the progress sees it", async () => {
		const { ports, clock } = await withTestEvent();
		const [project] = await listProjects(ports.db, clock.now());
		expect(project).toMatchObject({ events_today: 0, events_24h: 0, last_event_at: null });
		const [app] = (await onboardingProgress(ports.db, clock.now())).apps;
		expect(app).toMatchObject({ test_event_at: "2026-10-10T12:00:00.000Z", first_event_at: null });
	});

	it("is never triaged or embedded", async () => {
		const { ports, issueId } = await withTestEvent();
		await ports.db.run(
			sql`UPDATE issues SET status = 'unresolved', times_seen = 5 WHERE id = ${issueId}`,
		);
		const clef = fakeClef();
		const ai = { ...ports.config.ai, triage: true, similar: true };
		expect(
			await runTriage({ ...ports, models: clef.runner, config: { ...ports.config, ai } }),
		).toBe(0);
		const embeddings = fakeEmbeddings();
		expect(
			await runEmbeddings(
				{
					...ports,
					models: embeddings.runner,
					vectors: sqliteVectorIndex(ports.db),
					config: { ...ports.config, ai },
				},
				ports.clock.now(),
			),
		).toBe(0);
	});

	it("a normal event is unchanged", async () => {
		const { ports, clock } = await testPorts();
		const p = await createProject(ports, { name: "x" });
		const prepared = await prepareEvent(
			new TextEncoder().encode('{"message":"real"}'),
			clock.now(),
		);
		await storeEvent(ports, new IngestState(), p.internalId, prepared);
		expect(await ports.db.first(sql`SELECT test, status FROM issues`)).toEqual({
			test: 0,
			status: "unresolved",
		});
	});
});
