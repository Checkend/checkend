import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

const TOKEN = "issue-filters-admin-token-0123";

async function setup() {
	const t = await testPorts({ config: { adminToken: TOKEN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const state = new IngestState();
	const app = createApp({ state });
	const store = async (type: string, extra: Record<string, unknown> = {}) => {
		const raw = { exception: { values: [{ type, value: `${type} failed` }] }, ...extra };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, state, project.internalId, prepared, { sleep: async () => {} });
	};
	const titles = async (query: string) => {
		const response = await app.request(
			`https://checkend.test/v1/issues?${query}`,
			{ headers: { authorization: `Bearer ${TOKEN}` } },
			{ ports: t.ports },
		);
		const body = (await response.json()) as { data?: { title: string }[]; error?: string };
		return { status: response.status, body, titles: (body.data ?? []).map((i) => i.title).sort() };
	};
	// Three issues, seen at different times, releases and environments.
	await store("AlphaError", { release: "shop@1.0.0", environment: "production" });
	t.clock.advance(3 * 3600_000);
	await store("BetaError", { release: "shop@1.1.0", environment: "staging" });
	t.clock.advance(3600_000);
	await store("Gamma_100%Error", { release: "shop@1.1.0", environment: "production" });
	return { ...t, project, titles };
}

describe("GET /v1/issues filters", () => {
	it("returns 404 project_not_found for an unknown project ID or slug", async () => {
		const { titles, project } = await setup();
		expect(await titles("project=no-such-project")).toMatchObject({
			status: 404,
			body: { error: "project_not_found" },
		});
		expect(await titles("project=1234567890")).toMatchObject({
			status: 404,
			body: { error: "project_not_found" },
		});
		expect((await titles(`project=${project.id}`)).titles).toHaveLength(3);
		expect((await titles("project=shop")).titles).toHaveLength(3);
	});

	it("filters by release and by environment", async () => {
		const { titles } = await setup();
		expect((await titles("release=shop@1.1.0")).titles).toEqual([
			"BetaError: BetaError failed",
			"Gamma_100%Error: Gamma_100%Error failed",
		]);
		expect((await titles("environment=production")).titles).toEqual([
			"AlphaError: AlphaError failed",
			"Gamma_100%Error: Gamma_100%Error failed",
		]);
		expect((await titles("release=shop@9.9.9")).titles).toEqual([]);
	});

	it("filters by since: a duration or an ISO time", async () => {
		const { titles } = await setup();
		// The clock is at 16:00; the issues were last seen at 12:00, 15:00 and 16:00.
		expect((await titles("since=2h")).titles).toHaveLength(2);
		expect((await titles("since=30m")).titles).toEqual(["Gamma_100%Error: Gamma_100%Error failed"]);
		expect((await titles("since=2026-10-10T14:30:00Z")).titles).toHaveLength(2);
		expect((await titles("since=1d")).titles).toHaveLength(3);
		expect((await titles("since=yesterday")).status).toBe(400);
	});

	it("searches the title, and treats % and _ as plain characters", async () => {
		const { titles } = await setup();
		expect((await titles("search=beta")).titles).toEqual(["BetaError: BetaError failed"]);
		expect((await titles("search=100%25")).titles).toEqual([
			"Gamma_100%Error: Gamma_100%Error failed",
		]);
		expect((await titles("search=%25")).titles).toEqual([
			"Gamma_100%Error: Gamma_100%Error failed",
		]);
		expect((await titles("search=_")).titles).toEqual(["Gamma_100%Error: Gamma_100%Error failed"]);
		expect((await titles(`search=${"x".repeat(201)}`)).status).toBe(400);
	});

	it("combines filters", async () => {
		const { titles } = await setup();
		expect((await titles("environment=production&since=2h&search=gamma")).titles).toHaveLength(1);
	});
});
