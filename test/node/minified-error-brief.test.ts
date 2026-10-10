import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { recordDeploy } from "../../src/core/fixes.ts";
import { handleGithubEvent } from "../../src/core/github.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject, updateProject } from "../../src/core/projects.ts";
import { uploadSourceMap } from "../../src/core/sourcemaps.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import { expectSpecBrief } from "../support/brief-check.ts";
import { testPorts } from "../support/node-ports.ts";

/**
 * Increment 5 "done when": a minified browser error shows readable frames and the suspect commit.
 * The suspect is found through the mapped frame (src/cart.ts), not the minified file.
 */
describe("a minified browser error", () => {
	it("shows readable frames and the suspect commit", async () => {
		const { ports, clock } = await testPorts();
		const project = await createProject(ports, { name: "Web shop" });
		await updateProject(ports, BOOTSTRAP_ADMIN, project.slug, { repository: "acme/web" });
		const head = "9".repeat(40);
		await handleGithubEvent(ports, "push", "web-1", {
			ref: "refs/heads/main",
			repository: { full_name: "acme/web" },
			commits: [
				{
					id: "8".repeat(40),
					message: "Faster totals",
					author: { username: "grace" },
					modified: ["src/cart.ts"],
				},
				{ id: head, message: "Copy", author: { username: "ada" }, modified: ["src/copy.ts"] },
			],
		});
		await recordDeploy(ports, BOOTSTRAP_ADMIN, {
			project: project.slug,
			release: "web@7",
			commit: head,
			environment: "production",
			commits: [],
			pull_requests: [],
		});
		await uploadSourceMap(
			ports,
			BOOTSTRAP_ADMIN,
			{ project: project.slug, release: "web@7", name: "~/static/app.min.js" },
			readFileSync("test/fixtures/sourcemaps/app.min.js.map"),
			false,
		);
		const file = "https://shop.example/static/app.min.js";
		const raw = {
			platform: "javascript",
			release: "web@7",
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
		const prepared = await prepareEvent(new TextEncoder().encode(JSON.stringify(raw)), clock.now());
		await storeEvent(ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
		const issue = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
		const brief = await buildBrief(ports.db, issue, clock.now(), ports.blobs);
		expectSpecBrief(brief);
		expect(brief?.json.untrusted.exceptions[0]?.frames[0]).toMatchObject({
			file: "src/cart.ts",
			line: 13,
		});
		expect(brief?.json.issue.suspect_commit).toMatchObject({
			sha: "8".repeat(40),
			author: "grace",
			files: ["src/cart.ts"],
		});
		expect(brief?.markdown).toContain(">  13 | \tfor (const line of cart.lines!) {");
		expect(brief?.markdown).toContain(
			"| Suspect commit | 888888888888 by grace: changed src/cart.ts (frame c) |",
		);
	});
});
