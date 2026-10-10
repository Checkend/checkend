import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { d1Db } from "../../src/adapters/cloudflare/d1-db.ts";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import type { Ports } from "../../src/ports/index.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

/** A D1 binding that adds up the rows that D1 reports as written (the billed unit). */
function countingD1(d1: D1Database) {
	const counter = { rows: 0 };
	const wrapped = {
		prepare: (query: string) => d1.prepare(query),
		batch: async (statements: D1PreparedStatement[]) => {
			const results = await d1.batch(statements);
			for (const result of results) counter.rows += result.meta.rows_written ?? 0;
			return results;
		},
		exec: (query: string) => d1.exec(query),
		dump: () => d1.dump(),
		withSession: () => d1.withSession(),
	} as unknown as D1Database;
	return { wrapped, counter };
}

describe("D1 rows written per event (the cost model)", () => {
	it("measures each kind of ingest write", async () => {
		const { wrapped, counter } = countingD1(env.DB);
		const base = cloudflarePorts(env, createExecutionContext());
		const ports: Ports = {
			...base,
			db: d1Db(wrapped),
			config: { ...base.config, eventsPerIssue: 2 },
		};
		const project = await createProject(ports, { name: `Rows ${Date.now()}` });
		const state = new IngestState();
		let n = 0;
		const write = async (message: string, user?: string, tags: Record<string, string> = {}) => {
			const raw = { message, ...(user ? { user: { id: user } } : {}), tags };
			const prepared = await prepareEvent(
				new TextEncoder().encode(JSON.stringify(raw)),
				new Date(),
			);
			const before = counter.rows;
			n++;
			const result = await storeEvent(ports, state, project.internalId, prepared);
			return { real: counter.rows - before, estimate: result.rows };
		};
		const measured = {
			newIssue: await write("plain"),
			storedRepeat: await write("plain"),
			cappedRepeat: await write("plain"),
			newIssueWithUser: await write("user", "u1"),
			storedRepeatSameUser: await write("user", "u1"),
			storedRepeatNewUser: await write("user", "u2"),
			cappedRepeatNewUser: await write("user", "u3"),
			newIssueTwoNewTags: await write("tags", undefined, { browser: "Safari", region: "eu" }),
		};
		console.log(`D1 rows written (real, estimate): ${JSON.stringify(measured)} (${n} writes)`);
		// The budget mode uses the estimate: it must not be below the real rows.
		for (const [shape, { real, estimate }] of Object.entries(measured)) {
			expect(estimate, shape).toBeGreaterThanOrEqual(real);
			expect(estimate, shape).toBeLessThanOrEqual(real + 6);
		}
	});
});
