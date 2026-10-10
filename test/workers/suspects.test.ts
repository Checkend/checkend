import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { buildBrief } from "../../src/core/brief.ts";
import { recordDeploy } from "../../src/core/fixes.ts";
import { handleGithubEvent } from "../../src/core/github.ts";
import { fetchDeployCommits } from "../../src/core/github-commits.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject, updateProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import type { Ports } from "../../src/ports/index.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

describe("suspect commits on D1", () => {
	it("stores push commits and GitHub API commits, and finds the suspect", async () => {
		const base = cloudflarePorts(env, createExecutionContext());
		const ports: Ports = {
			...base,
			config: { ...base.config, githubToken: "t" },
			http: {
				send: async () =>
					new Response(
						JSON.stringify({
							sha: "e".repeat(40),
							commit: { message: "Edit cart", author: { date: "2026-10-09T00:00:00Z" } },
							author: { login: "ada" },
							files: [{ filename: "src/cart.ts" }],
						}),
					),
			},
		};
		const project = await createProject(ports, { name: "D1 suspects" });
		await updateProject(ports, BOOTSTRAP_ADMIN, project.slug, { repository: "acme/d1-suspects" });
		await handleGithubEvent(ports, "push", `d1-suspects-${Date.now()}`, {
			ref: "refs/heads/main",
			repository: { full_name: "acme/d1-suspects" },
			commits: [{ id: "d".repeat(40), message: "Docs", modified: ["README.md"] }],
		});
		await recordDeploy(ports, BOOTSTRAP_ADMIN, {
			project: project.slug,
			release: "d1@1",
			commit: "e".repeat(40),
			environment: "production",
			commits: [],
			pull_requests: [],
		});
		expect(await fetchDeployCommits(ports)).toBeGreaterThan(0);
		while ((await fetchDeployCommits(ports)) > 0) {
			// other test files can leave deploys behind; handle them all
		}
		const raw = {
			release: "d1@1",
			exception: {
				values: [
					{
						type: "TypeError",
						value: "x",
						stacktrace: {
							frames: [{ filename: "src/cart.ts", function: "cartTotal", lineno: 3, in_app: true }],
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
		const brief = await buildBrief(ports.db, issue, new Date(), null);
		expect(brief?.json.issue.suspect_commit).toMatchObject({
			sha: "e".repeat(40),
			author: "ada",
			files: ["src/cart.ts"],
		});
	});
});
