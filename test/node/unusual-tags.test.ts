import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { expectSpecBrief } from "../support/brief-check.ts";
import { testPorts } from "../support/node-ports.ts";

async function setup() {
	const t = await testPorts();
	const project = await createProject(t.ports, { name: "Shop" });
	const store = async (message: string, tags: Record<string, string>) => {
		const raw = { message, tags };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
		return (
			await t.ports.db.first<{ id: number }>(
				sql`SELECT id FROM issues WHERE fingerprint = ${prepared.fingerprint.hash}`,
			)
		)?.id as number;
	};
	return { ...t, store };
}

describe("tags that differ from normal", () => {
	it("names tag values that are much more common in the issue than in the project", async () => {
		const { store, ports, clock } = await setup();
		for (let i = 0; i < 30; i++) {
			await store(`other error ${i % 5}`, {
				browser: i % 2 ? "Chrome" : "Firefox",
				env: "production",
			});
		}
		let issue = 0;
		for (let i = 0; i < 4; i++) {
			issue = await store("checkout failed", { browser: "Safari", env: "production" });
		}
		const brief = await buildBrief(ports.db, issue, clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.untrusted.unusual_tags).toEqual([
			{ key: "browser", value: "Safari", issue_share: 1, project_share: 0 },
		]);
		expect(brief?.markdown).toContain(
			"unusual tag browser: Safari (100% of this issue, 0% of the project)",
		);
	});

	it("needs enough events in the issue and in the project", async () => {
		const { store, ports, clock } = await setup();
		for (let i = 0; i < 5; i++) await store(`other ${i}`, { browser: "Chrome" });
		const issue = await store("checkout failed", { browser: "Safari" });
		const brief = await buildBrief(ports.db, issue, clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.untrusted.unusual_tags).toEqual([]);
	});
});
