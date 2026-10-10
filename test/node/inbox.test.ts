import { describe, expect, it } from "vitest";
import {
	type InboxPage,
	type InboxQuery,
	inboxFacets,
	issueTags,
	listInbox,
} from "../../src/core/inbox.ts";
import { createProject } from "../../src/core/projects.ts";
import { testPorts } from "../support/node-ports.ts";
import { errorEvent, send } from "../support/seed.ts";

async function seeded() {
	const t = await testPorts();
	const shop = await createProject(t.ports, { name: "Shop" });
	const api = await createProject(t.ports, { name: "API" });
	await send(
		t,
		shop,
		errorEvent({ type: "TypeError", fn: "computeTotal", release: "shop@1.0.0" }),
		errorEvent({ type: "TypeError", fn: "computeTotal", release: "shop@1.1.0" }),
	);
	t.clock.advance(60_000);
	await send(
		t,
		shop,
		errorEvent({
			type: "RangeError",
			fn: "paginate",
			environment: "staging",
			tags: { browser: "Firefox" },
		}),
	);
	t.clock.advance(60_000);
	await send(t, api, errorEvent({ type: "DatabaseError", fn: "query", value: "deadlock found" }));
	return { ...t, shop, api };
}

const titles = (page: InboxPage) => page.data.map((i) => i.title);

describe("inbox", () => {
	it("lists issues by last seen, with counts and the public project ID", async () => {
		const { ports, shop, api } = await seeded();
		const page = await listInbox(ports.db, { limit: 25 });
		expect(titles(page)).toEqual([
			"DatabaseError: deadlock found",
			expect.stringMatching(/^RangeError/),
			expect.stringMatching(/^TypeError/),
		]);
		expect(page.data[2]).toMatchObject({
			times_seen: 2,
			project_id: shop.id,
			project_name: "Shop",
		});
		expect(page.data[0]).toMatchObject({ project_id: api.id });
		expect(page.next_cursor).toBeNull();
	});

	it("filters by project (public ID or slug), status, environment, release and text", async () => {
		const { ports, shop } = await seeded();
		const query = async (filters: Omit<InboxQuery, "limit">) =>
			titles(await listInbox(ports.db, { limit: 25, ...filters }));
		expect(await query({ project: String(shop.id) })).toHaveLength(2);
		expect(await query({ project: "api" })).toEqual(["DatabaseError: deadlock found"]);
		expect(await query({ status: "resolved" })).toEqual([]);
		expect(await query({ environment: "staging" })).toEqual([expect.stringMatching(/^RangeError/)]);
		expect(await query({ release: "shop@1.1.0" })).toEqual([expect.stringMatching(/^TypeError/)]);
		expect(await query({ q: "deadlock" })).toEqual(["DatabaseError: deadlock found"]);
		expect(await query({ q: "100%_" })).toEqual([]);
	});

	it("pages with a cursor", async () => {
		const { ports } = await seeded();
		const first = await listInbox(ports.db, { limit: 2 });
		expect(first.data).toHaveLength(2);
		expect(first.next_cursor).not.toBeNull();
		const second = await listInbox(ports.db, { limit: 2, cursor: first.next_cursor ?? "" });
		expect(second.data).toHaveLength(1);
		expect(second.next_cursor).toBeNull();
	});

	it("lists the projects, environments and releases for the filters", async () => {
		const { ports } = await seeded();
		const facets = await inboxFacets(ports.db);
		expect(facets.projects.map((p) => p.name)).toEqual(["API", "Shop"]);
		expect(facets.environments).toEqual(["production", "staging"]);
		expect(facets.releases).toEqual(["shop@1.0.0", "shop@1.1.0"]);
	});

	it("counts tag values over the stored events of an issue", async () => {
		const { ports } = await seeded();
		const typeError = (await listInbox(ports.db, { limit: 25, q: "TypeError" })).data[0];
		const tags = await issueTags(ports.db, Number(typeError?.id));
		expect(tags).toContainEqual({ key: "region", value: "us-east", count: 2 });
		expect(tags).toContainEqual({ key: "environment", value: "production", count: 2 });
		expect(tags).toContainEqual({ key: "release", value: "shop@1.0.0", count: 1 });
	});
});
