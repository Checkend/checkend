import { describe, expect, it } from "vitest";
import { sqliteVectorIndex } from "../../../src/adapters/node/vector-index.ts";
import {
	embedTexts,
	runEmbeddings,
	runNeighbors,
	searchSimilar,
	similarIssues,
} from "../../../src/core/ai/similar.ts";
import { buildBrief } from "../../../src/core/brief.ts";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject } from "../../../src/core/projects.ts";
import { runScheduled } from "../../../src/core/scheduler.ts";
import { sql } from "../../../src/ports/db.ts";
import { expectSpecBrief } from "../../support/brief-check.ts";
import { fakeEmbeddings } from "../../support/fake-embeddings.ts";
import { testPorts } from "../../support/node-ports.ts";

const ERRORS = [
	"TypeError: cannot read total of cart items for checkout",
	"TypeError: cannot read total of cart items in checkout page",
	"Database connection timeout while saving invoice jane@example.com",
];

async function setup(similar = true) {
	const fake = fakeEmbeddings();
	const t = await testPorts({ models: fake.runner });
	const ports = {
		...t.ports,
		vectors: sqliteVectorIndex(t.ports.db),
		config: { ...t.ports.config, ai: { ...t.ports.config.ai, similar } },
	};
	const shop = await createProject(ports, { name: "Shop" });
	const web = await createProject(ports, { name: "Web" });
	const state = new IngestState();
	const ids: number[] = [];
	for (const [i, message] of ERRORS.entries()) {
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify({ message })),
			t.clock.now(),
		);
		await storeEvent(ports, state, (i === 1 ? web : shop).internalId, prepared);
		ids.push(
			(await ports.db.first<{ id: number }>(sql`SELECT max(id) AS id FROM issues`))?.id ?? 0,
		);
	}
	return { ...t, ports, fake, ids };
}

describe("embeddings", () => {
	it("are off without AI_SIMILAR, models or a vector index", async () => {
		const { ports, fake } = await setup(false);
		expect(await runEmbeddings(ports, ports.clock.now())).toBe(0);
		expect(
			await runEmbeddings(
				{
					...ports,
					config: { ...ports.config, ai: { ...ports.config.ai, similar: true } },
					vectors: null,
				},
				ports.clock.now(),
			),
		).toBe(0);
		expect(fake.calls).toHaveLength(0);
	});

	it("embeds new issues in one call, with the scrubbed text, once", async () => {
		const { ports, fake, ids } = await setup();
		expect(await runEmbeddings(ports, ports.clock.now())).toBe(3);
		expect(fake.calls).toHaveLength(1);
		expect(JSON.stringify(fake.calls[0]?.input)).not.toContain("jane@example.com");
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM vectors`)).toEqual({ n: 3 });
		expect(
			await ports.db.first<{ text: string }>(
				sql`SELECT text FROM issue_embeddings WHERE issue_id = ${ids[2] ?? 0}`,
			),
		).toEqual({
			text: expect.stringContaining("<email>"),
		});
		expect(await runEmbeddings(ports, ports.clock.now())).toBe(0);
		expect(fake.calls).toHaveLength(1);
	});

	it("rejects vectors of the wrong size", async () => {
		const fake = fakeEmbeddings({ dims: 768 });
		await expect(embedTexts(fake.runner, ["a"])).rejects.toThrow(/1024/);
	});
});

describe("similar issues", () => {
	it("finds the similar issue (also in another project) after the index settles, and not the others", async () => {
		const { ports, ids, clock } = await setup();
		await runEmbeddings(ports, clock.now());
		expect(await runNeighbors(ports, clock.now())).toBe(0); // Vectorize needs a few seconds
		clock.advance(120_000);
		expect(await runNeighbors(ports, clock.now())).toBe(3);
		const [a, b, c] = ids as [number, number, number];
		expect((await similarIssues(ports.db, a)).map((s) => s.id)).toEqual([b]);
		expect((await similarIssues(ports.db, b)).map((s) => s.id)).toEqual([a]);
		expect(await similarIssues(ports.db, c)).toEqual([]);
		expect(await runNeighbors(ports, clock.now())).toBe(0);

		const brief = await buildBrief(ports.db, a, clock.now());
		expectSpecBrief(brief);
		expect(brief?.json.similar_issues).toEqual([
			{
				id: b,
				project_id: expect.any(Number),
				status: "unresolved",
				score: expect.any(Number),
				title: ERRORS[1],
			},
		]);
		expect(brief?.markdown).toContain("Similar issues");
	});

	it("searches by issue or by text, live", async () => {
		const { ports, ids, clock } = await setup();
		await runEmbeddings(ports, clock.now());
		const [a, b, c] = ids as [number, number, number];
		const byIssue = await searchSimilar(ports, { issueId: a }, 5);
		expect(byIssue?.[0]?.id).toBe(b);
		expect(byIssue?.map((s) => s.id)).not.toContain(a);
		const byText = await searchSimilar(ports, { text: "invoice database connection timeout" }, 5);
		expect(byText?.[0]?.id).toBe(c);
	});

	it("runs in the scheduled jobs", async () => {
		const { ports, ids, clock } = await setup();
		expect((await runScheduled(ports, clock.now())).errors).toEqual([]);
		clock.advance(5 * 60_000);
		await runScheduled(ports, clock.now());
		expect((await similarIssues(ports.db, ids[0] ?? 0)).map((s) => s.id)).toEqual([ids[1]]);
	});
});
