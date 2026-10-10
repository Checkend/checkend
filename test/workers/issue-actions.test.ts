import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { claimIssue } from "../../src/core/claims.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { mergeIssues, splitIssue } from "../../src/core/issue-actions.ts";
import { listLabels } from "../../src/core/labels.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("issue actions on D1", () => {
	it("splits (json_each), merges and claims with the D1 SQL", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		const project = await createProject(ports, { name: "D1 actions" });
		const state = new IngestState();
		for (const message of ["one", "two", "three"]) {
			const raw = new TextEncoder().encode(
				JSON.stringify({ message, fingerprint: ["d1-actions"], user: { id: message } }),
			);
			await storeEvent(ports, state, project.internalId, await prepareEvent(raw, new Date()), {
				sleep: async () => {},
			});
		}
		const issue =
			(
				await ports.db.first<{ id: number }>(
					sql`SELECT id FROM issues WHERE project_id = ${project.internalId}`,
				)
			)?.id ?? 0;
		const events = await ports.db.all<{ id: number }>(
			sql`SELECT id FROM events WHERE issue_id = ${issue} ORDER BY id`,
		);
		const split = await splitIssue(ports, BOOTSTRAP_ADMIN, issue, [
			events[0]?.id ?? 0,
			events[1]?.id ?? 0,
		]);
		expect(split.kind).toBe("done");
		if (split.kind !== "done") return;
		const counts = await ports.db.all(
			sql`SELECT id, times_seen, stored_events FROM issues WHERE id IN (${issue}, ${split.newIssueId}) ORDER BY id`,
		);
		expect(counts).toEqual([
			{ id: issue, times_seen: 1, stored_events: 1 },
			{ id: split.newIssueId, times_seen: 2, stored_events: 2 },
		]);
		expect((await mergeIssues(ports, BOOTSTRAP_ADMIN, issue, [split.newIssueId])).kind).toBe(
			"done",
		);
		expect(
			await ports.db.first(
				sql`SELECT times_seen, stored_events, users_affected FROM issues WHERE id = ${issue}`,
			),
		).toEqual({
			times_seen: 3,
			stored_events: 3,
			users_affected: 3,
		});
		expect((await claimIssue(ports, BOOTSTRAP_ADMIN, issue)).kind).toBe("done");
		const labels = await listLabels(ports.db, { limit: 10 }, new Date());
		expect(labels.map((l) => [l.label, l.corrects])).toEqual([
			["merged", null],
			["split", "grouping"],
		]);
	});
});
