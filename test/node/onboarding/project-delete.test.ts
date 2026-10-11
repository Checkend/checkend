import { describe, expect, it } from "vitest";
import { verifyFixes } from "../../../src/core/fixes.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { getIssue, listIssues } from "../../../src/core/issues.ts";
import { deleteProject, runProjectPurge } from "../../../src/core/project-delete.ts";
import { createProject, listProjects } from "../../../src/core/projects.ts";
import { onboardingProgress } from "../../../src/core/setup-progress.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../../src/core/tokens.ts";
import { deliverDue } from "../../../src/core/webhooks.ts";
import { sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";
import { ADMIN, setupApi } from "../../support/setup-api.ts";

const MEMBER = { type: "member" as never, id: 1, name: "simon", scopes: ["admin" as const] };

async function projectWithData() {
	const t = await testPorts();
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	for (const message of ["a", "b", "a"]) {
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify({ message, tags: { k: "v" } })),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared);
	}
	const other = await createProject(t.ports, { name: "Other" });
	await storeEvent(
		t.ports,
		state,
		other.internalId,
		await prepareEvent(new TextEncoder().encode('{"message":"keep"}'), t.clock.now()),
	);
	return { ...t, project, other };
}

describe("deleteProject", () => {
	it("revokes the keys, hides the project and its issues, frees the slug, and writes activity", async () => {
		const { ports, clock, project } = await projectWithData();
		const issueId =
			(
				await ports.db.first<{ id: number }>(
					sql`SELECT id FROM issues WHERE project_id = ${project.internalId}`,
				)
			)?.id ?? 0;
		expect(await deleteProject(ports, BOOTSTRAP_ADMIN, project.slug)).toBe("deleted");
		expect(
			await ports.db.first(
				sql`SELECT count(*) AS n FROM project_keys WHERE project_id = ${project.internalId} AND revoked_at IS NULL`,
			),
		).toEqual({ n: 0 });
		expect((await listProjects(ports.db, clock.now())).map((p) => p.name)).toEqual(["Other"]);
		const page = await listIssues(ports.db, { limit: 50 } as never, null, clock.now());
		expect(typeof page === "string" ? page : page.data.map((i) => i.title)).toEqual(["keep"]);
		expect(await getIssue(ports.db, issueId, clock.now())).toBeNull();
		expect(
			(await onboardingProgress(ports.db, clock.now())).apps.map((a) => a.project.name),
		).toEqual(["Other"]);
		expect(
			await ports.db.first(
				sql`SELECT action, target_id FROM activity WHERE action = 'project.delete'`,
			),
		).toEqual({ action: "project.delete", target_id: project.id });
		// The name is free again.
		expect((await createProject(ports, { name: "Shop" })).slug).toBe("shop");
		expect(await deleteProject(ports, BOOTSTRAP_ADMIN, String(project.id))).toBe("not_found");
	});

	it("with REQUIRE_APPROVAL=delete_project: a token asks, another actor completes", async () => {
		const { ports, project } = await projectWithData();
		const approval = { ...ports, config: { ...ports.config, requireApproval: ["delete_project"] } };
		expect(await deleteProject(approval, BOOTSTRAP_ADMIN, project.slug)).toBe("approval_required");
		expect(await deleteProject(approval, BOOTSTRAP_ADMIN, project.slug)).toBe("approval_required");
		expect(
			await ports.db.first(sql`SELECT deleted_at FROM projects WHERE id = ${project.internalId}`),
		).toEqual({ deleted_at: null });
		const { record } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "second admin",
			scopes: ["admin"],
		});
		const second = {
			type: "token" as const,
			id: record.id,
			name: record.name,
			scopes: record.scopes,
		};
		expect(await deleteProject(approval, second, project.slug)).toBe("deleted");
		expect(
			await ports.db.all(
				sql`SELECT action FROM activity WHERE action LIKE 'project.delete%' ORDER BY id`,
			),
		).toEqual([
			{ action: "project.delete_request" },
			{ action: "project.delete_request" },
			{ action: "project.delete" },
		]);
	});

	it("with REQUIRE_APPROVAL=delete_project: a human in the UI deletes at once", async () => {
		const { ports, project } = await projectWithData();
		const approval = { ...ports, config: { ...ports.config, requireApproval: ["delete_project"] } };
		expect(await deleteProject(approval, MEMBER, project.slug)).toBe("deleted");
	});
});

describe("runProjectPurge", () => {
	it("purges the data of a deleted project in chunks, keeps other projects, then marks it purged", async () => {
		const { ports, clock, project, other } = await projectWithData();
		await ports.db.run(sql`UPDATE issues SET merged_into = (SELECT min(id) FROM issues WHERE project_id = ${project.internalId}), status = 'merged'
			WHERE id = (SELECT max(id) FROM issues WHERE project_id = ${project.internalId})`);
		await deleteProject(ports, BOOTSTRAP_ADMIN, project.slug);
		let total = 0;
		for (let i = 0; i < 10; i++)
			total += await runProjectPurge(ports, clock.now(), { chunkSize: 1, maxChunks: 2 });
		expect(total).toBeGreaterThan(0);
		const id = project.internalId;
		expect(
			await ports.db.first(sql`SELECT
				(SELECT count(*) FROM events WHERE project_id = ${id}) +
				(SELECT count(*) FROM issues WHERE project_id = ${id}) +
				(SELECT count(*) FROM tag_keys WHERE project_id = ${id}) AS n`),
		).toEqual({ n: 0 });
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM issue_counts`)).toEqual({ n: 1 });
		expect(
			await ports.db.first(
				sql`SELECT count(*) AS n FROM issues WHERE project_id = ${other.internalId}`,
			),
		).toEqual({ n: 1 });
		expect(
			await ports.db.first(sql`SELECT purged_at FROM projects WHERE id = ${project.internalId}`),
		).toEqual({ purged_at: null });
		clock.advance(11 * 60_000);
		await runProjectPurge(ports, clock.now());
		expect(
			await ports.db.first(
				sql`SELECT purged_at IS NOT NULL AS done FROM projects WHERE id = ${project.internalId}`,
			),
		).toEqual({ done: 1 });
		expect(await runProjectPurge(ports, clock.now())).toBe(0);
	});
});

describe("DELETE /v1/projects/:project", () => {
	it("needs admin, deletes, and ingest with the old key gets 401 at once", async () => {
		const { call, ports, app } = await setupApi();
		const project = await createProject(ports, { name: "Shop" });
		const send = () =>
			app.request(
				`/api/${project.id}/store/?sentry_key=${project.publicKey}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: '{"message":"x"}',
				},
				{ ports },
			);
		expect((await send()).status).toBe(200);
		const { token } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "w",
			scopes: ["issues:write"],
		});
		expect((await call("DELETE", `/v1/projects/${project.slug}`, token)).status).toBe(403);
		expect((await call("DELETE", `/v1/projects/${project.slug}`, ADMIN)).status).toBe(204);
		expect((await send()).status).toBe(401);
		expect((await call("DELETE", `/v1/projects/${project.slug}`, ADMIN)).status).toBe(404);
		expect((await call("GET", "/v1/projects", ADMIN)).body?.data).toEqual([]);
	});

	it("answers 202 when the delete waits for approval", async () => {
		const { call, ports } = await setupApi();
		const project = await createProject(ports, { name: "Shop" });
		ports.config.requireApproval = ["delete_project"];
		const response = await call("DELETE", `/v1/projects/${project.slug}`, ADMIN);
		expect(response.status).toBe(202);
		expect(response.body).toMatchObject({ status: "approval_required" });
	});
});

describe("no alerts for a deleted project before the purge", () => {
	it("does not send its pending webhook deliveries, and does not verify its fixes", async () => {
		const { ports, clock, project } = await projectWithData();
		const sent: string[] = [];
		const withHttp = {
			...ports,
			http: { send: async (url: string) => (sent.push(url), new Response("ok")) },
		};
		const issueId =
			(
				await ports.db.first<{ id: number }>(
					sql`SELECT id FROM issues WHERE project_id = ${project.internalId}`,
				)
			)?.id ?? 0;
		const now = clock.now().toISOString();
		await ports.db.run(
			sql`INSERT INTO webhooks (uid, name, url, secret, events, created_at, created_by)
				VALUES ('w1', 'hook', 'https://hooks.example/x', 'secret-for-test', 'issue.new', ${now}, 'test')`,
		);
		await ports.db.run(
			sql`INSERT INTO webhook_deliveries (webhook_id, event, issue_id, next_attempt_at, created_at)
				VALUES ((SELECT id FROM webhooks), 'issue.new', ${issueId}, ${now}, ${now})`,
		);
		await ports.db.run(sql`UPDATE issues SET status = 'fix_pending' WHERE id = ${issueId}`);
		await ports.db.run(
			sql`INSERT INTO fixes (issue_id, kind, ref, linked_by_type, linked_by, linked_at, deployed_at)
				VALUES (${issueId}, 'commit', 'abc', 'token', 'agent', ${now}, ${now})`,
		);
		await deleteProject(ports, BOOTSTRAP_ADMIN, project.slug);
		clock.advance(48 * 3_600_000);
		await deliverDue(withHttp);
		expect(sent).toEqual([]);
		expect(await ports.db.first(sql`SELECT status, last_error FROM webhook_deliveries`)).toEqual({
			status: "failed",
			last_error: "The project was deleted.",
		});
		expect(await verifyFixes(ports, clock.now())).toBe(0);
	});
});
