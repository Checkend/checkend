import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { runRetention } from "../../src/core/retention.ts";
import { sql } from "../../src/ports/db.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("retention on D1", () => {
	it("deletes old events and hourly counts with the D1 SQL", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		const project = await createProject(ports, { name: "D1 retention" });
		for (const message of ["one", "two"]) {
			const prepared = await prepareEvent(
				new TextEncoder().encode(JSON.stringify({ message })),
				new Date(),
			);
			await storeEvent(ports, new IngestState(), project.internalId, prepared);
		}
		const later = new Date(Date.now() + 100 * 86_400_000);
		const run = await runRetention(ports, later);
		expect(run.events).toBeGreaterThanOrEqual(2);
		expect(run.counts).toBeGreaterThanOrEqual(2);
		expect(
			await ports.db.first(
				sql`SELECT count(*) AS n FROM events WHERE project_id = ${project.internalId}`,
			),
		).toEqual({ n: 0 });
		expect(
			await ports.db.first(
				sql`SELECT sum(stored_events) AS n FROM issues WHERE project_id = ${project.internalId}`,
			),
		).toEqual({ n: 0 });
	});
});
