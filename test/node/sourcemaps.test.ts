import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { buildSourceMapIndex } from "../../src/core/sourcemap-index.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import type { Ports } from "../../src/ports/index.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "sourcemaps-admin-token-0123456789";
const mapText = readFileSync("test/fixtures/sourcemaps/app.min.js.map", "utf8");

async function setup(overrides: Partial<Ports> = {}) {
	const t = await testPorts({ ...overrides, config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const ci = (
		await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "ci", scopes: ["releases:write"] })
	).token;
	const reader = (
		await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "reader", scopes: ["issues:read"] })
	).token;
	const upload = async (
		query: Record<string, string>,
		body: string | Uint8Array = mapText,
		contentType = "application/json",
		token = ci,
	) => {
		const response = await app.request(
			`https://checkend.test/v1/sourcemaps?${new URLSearchParams({ project: project.slug, release: "shop@1", ...query })}`,
			{
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": contentType },
				body,
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const call = async (method: string, path: string, token = ADMIN) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{ method, headers: { authorization: `Bearer ${token}` } },
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	/** An error from the minified bundle: `t.lines` is not iterable, in function c. */
	const storeError = async (
		release = "shop@1",
		file = "https://shop.example/static/app.min.js?v=3",
	) => {
		const raw = {
			platform: "javascript",
			release,
			exception: {
				values: [
					{
						type: "TypeError",
						value: "t.lines is not iterable",
						stacktrace: {
							frames: [
								{
									filename: file,
									abs_path: file,
									function: "b",
									lineno: 1,
									colno: 634,
									in_app: true,
								},
								{
									filename: file,
									abs_path: file,
									function: "c",
									lineno: 1,
									colno: 579,
									in_app: true,
								},
							],
						},
					},
				],
			},
		};
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
		return (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues ORDER BY id DESC`))
			?.id as number;
	};
	const brief = async (id: number) => buildBrief(t.ports.db, id, t.clock.now(), t.ports.blobs);
	return { ...t, project, upload, call, storeError, brief, reader, ci };
}

describe("source maps: upload", () => {
	it("indexes a source map once, at upload", async () => {
		const { upload, call, project } = await setup();
		const response = await upload({ name: "~/static/app.min.js" });
		expect(response.status).toBe(201);
		expect(response.body.data).toMatchObject({
			project_id: project.id,
			release: "shop@1",
			name: "~/static/app.min.js",
			path: "/static/app.min.js",
			sources: 1,
			size: expect.any(Number),
		});
		const listed = await call("GET", `/v1/sourcemaps?project=${project.slug}&release=shop@1`);
		expect(listed.body.data).toEqual([expect.objectContaining({ name: "~/static/app.min.js" })]);
	});

	it("accepts a prebuilt index (built by a client), and checks it", async () => {
		const { upload } = await setup();
		const index = buildSourceMapIndex(JSON.parse(mapText));
		const type = "application/x-checkend-sourcemap-index";
		expect((await upload({ name: "~/static/app.min.js" }, index, type)).status).toBe(201);
		const broken = index.slice(0, index.length - 3);
		const rejected = await upload({ name: "~/static/app.min.js" }, broken, type);
		expect(rejected.status).toBe(400);
		expect(rejected.body.error).toBe("invalid_sourcemap");
	});

	it("rejects invalid maps, other content types, missing parameters and other scopes", async () => {
		const { upload, reader } = await setup();
		const name = { name: "~/app.min.js" };
		expect((await upload(name, '{"version":2}')).body).toMatchObject({
			error: "invalid_sourcemap",
		});
		expect((await upload(name, "{nope")).status).toBe(400);
		expect((await upload(name, mapText, "text/plain")).status).toBe(415);
		expect((await upload({})).status).toBe(400);
		expect((await upload({ name: "~/x.js", release: "" })).status).toBe(400);
		expect((await upload({ name: "~/x.js", project: "no-such" })).status).toBe(404);
		expect((await upload(name, mapText, "application/json", reader)).status).toBe(403);
	});

	it("rejects a body above the size limit (413)", async () => {
		const { upload } = await setup();
		const huge = JSON.stringify({
			version: 3,
			sources: [],
			mappings: "A".repeat(31 * 1024 * 1024),
		});
		expect((await upload({ name: "~/x.js" }, huge)).status).toBe(413);
	});

	it("is off without blob storage (400 storage_not_configured)", async () => {
		const { upload } = await setup({ blobs: null });
		expect((await upload({ name: "~/x.js" })).body).toMatchObject({
			error: "storage_not_configured",
		});
	});

	it("replaces the map of the same release and file; DELETE removes it", async () => {
		const { upload, call, project, ci } = await setup();
		await upload({ name: "~/static/app.min.js" });
		const second = await upload({ name: "https://cdn.example/static/app.min.js" });
		const list = await call("GET", `/v1/sourcemaps?project=${project.slug}&release=shop@1`);
		expect(list.body.data).toEqual([expect.objectContaining({ id: second.body.data.id })]);
		expect((await call("DELETE", `/v1/sourcemaps/${second.body.data.id}`, ci)).status).toBe(200);
		expect(
			(await call("GET", `/v1/sourcemaps?project=${project.slug}&release=shop@1`)).body.data,
		).toEqual([]);
	});
});

describe("source maps: readable frames in the brief", () => {
	it("maps minified frames to the original file, line and source", async () => {
		const { upload, storeError, brief } = await setup();
		await upload({ name: "~/static/app.min.js" });
		const result = await brief(await storeError());
		const [top] = result?.json.untrusted.exceptions[0]?.frames ?? [];
		expect(top).toMatchObject({
			function: "c",
			file: "src/cart.ts",
			line: 13,
			minified: "https://shop.example/static/app.min.js?v=3:1:579",
		});
		expect(result?.markdown).toContain(">  13 | \tfor (const line of cart.lines!) {");
		expect(result?.markdown).toContain("src/cart.ts");
		expect(result?.json.issue.source_maps).toEqual({ frames: 2, mapped: 2 });
	});

	it("matches a map by file name when the path differs", async () => {
		const { upload, storeError, brief } = await setup();
		await upload({ name: "app.min.js" });
		const result = await brief(await storeError());
		expect(result?.json.untrusted.exceptions[0]?.frames[0]).toMatchObject({ file: "src/cart.ts" });
	});

	it("leaves frames as they are without a map for the release, or without storage", async () => {
		const { upload, storeError, brief } = await setup();
		await upload({ name: "~/static/app.min.js", release: "shop@2" });
		const result = await brief(await storeError("shop@1"));
		expect(result?.json.untrusted.exceptions[0]?.frames[0]).toMatchObject({
			file: "https://shop.example/static/app.min.js?v=3",
			line: 1,
			minified: null,
		});
		expect(result?.json.issue.source_maps).toEqual({ frames: 2, mapped: 0 });
		const none = await setup({ blobs: null });
		const plain = await none.brief(await none.storeError());
		expect(plain?.json.untrusted.exceptions[0]?.frames[0]).toMatchObject({ line: 1 });
	});
});
