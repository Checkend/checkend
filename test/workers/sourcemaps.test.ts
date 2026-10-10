import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { buildBrief } from "../../src/core/brief.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { uploadSourceMap } from "../../src/core/sourcemaps.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("source maps on R2 and D1", () => {
	it("uploads a map to R2 and maps the frames of the brief", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		const project = await createProject(ports, { name: "D1 sourcemaps" });
		const uploaded = await uploadSourceMap(
			ports,
			BOOTSTRAP_ADMIN,
			{ project: project.slug, release: "web@1", name: "~/static/app.min.js" },
			new TextEncoder().encode(env.TEST_SOURCEMAP),
			false,
		);
		expect(uploaded.kind).toBe("done");
		const file = "https://shop.example/static/app.min.js";
		const raw = {
			release: "web@1",
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
		await storeEvent(
			ports,
			new IngestState(),
			project.internalId,
			await prepareEvent(new TextEncoder().encode(JSON.stringify(raw)), new Date()),
		);
		const issue =
			(
				await ports.db.first<{ id: number }>(
					sql`SELECT id FROM issues WHERE project_id = ${project.internalId}`,
				)
			)?.id ?? 0;
		const brief = await buildBrief(ports.db, issue, new Date(), ports.blobs);
		expect(brief?.json.untrusted.exceptions[0]?.frames[0]).toMatchObject({
			file: "src/cart.ts",
			line: 13,
		});
	});
});
