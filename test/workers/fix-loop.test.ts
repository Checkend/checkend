import {
	applyD1Migrations,
	createExecutionContext,
	createScheduledController,
	env,
	waitOnExecutionContext,
} from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import {
	getRelease,
	linkFix,
	listFixOutcomes,
	listReleases,
	recordDeploy,
} from "../../src/core/fixes.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN } from "../../src/core/tokens.ts";
import worker from "../../src/entry/worker.ts";
import { sql } from "../../src/ports/db.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

const FIX = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

describe("the fix loop on D1", () => {
	it("deploys, verifies through the scheduled handler, and regresses at ingest", async () => {
		const ports = cloudflarePorts(env, createExecutionContext());
		const project = await createProject(ports, { name: "D1 fix loop" });
		const state = new IngestState();
		const store = async (release: string) => {
			const raw = new TextEncoder().encode(
				JSON.stringify({ message: "cart total failed", fingerprint: ["d1-fix"], release }),
			);
			await storeEvent(ports, state, project.internalId, await prepareEvent(raw, new Date()), {
				sleep: async () => {},
			});
		};
		await store("shop@1.0.0");
		const issue =
			(
				await ports.db.first<{ id: number }>(
					sql`SELECT id FROM issues WHERE project_id = ${project.internalId}`,
				)
			)?.id ?? 0;
		expect(await linkFix(ports, BOOTSTRAP_ADMIN, issue, { commit: FIX.slice(0, 12) })).toBe("done");
		const deploy = await recordDeploy(ports, BOOTSTRAP_ADMIN, {
			project: project.slug,
			release: "shop@1.0.1",
			commit: "f".repeat(40),
			environment: "production",
			commits: [FIX, "f".repeat(40)],
			pull_requests: [],
		});
		expect(deploy).toMatchObject({ release: "shop@1.0.1", fixes_deployed: [issue] });

		// One scheduled run, 25 hours later: the quiet period (24 h) is over.
		const ctx = createExecutionContext();
		const scheduledTime = Date.now() + 25 * 3_600_000;
		await worker.scheduled(createScheduledController({ scheduledTime }), env, ctx);
		await waitOnExecutionContext(ctx);
		const status = async () =>
			(await ports.db.first<{ status: string }>(sql`SELECT status FROM issues WHERE id = ${issue}`))
				?.status;
		expect(await status()).toBe("verified");

		await store("shop@1.0.0");
		expect(await status()).toBe("verified");
		await store("shop@1.0.1");
		expect(await status()).toBe("regressed");
		const regress = await ports.db.first<{ data: string }>(
			sql`SELECT data FROM activity WHERE target_id = ${issue} AND action = 'issue.regress'`,
		);
		expect(JSON.parse(regress?.data ?? "{}")).toMatchObject({
			from: "verified",
			to: "regressed",
			release: "shop@1.0.1",
		});

		const releases = await listReleases(ports.db, { project: project.slug, limit: 10 });
		expect(releases).toEqual([
			expect.objectContaining({ version: "shop@1.0.1", deploys: [expect.any(Object)] }),
		]);
		expect(await getRelease(ports.db, project.slug, "shop@1.0.1")).toMatchObject({
			regressed_issue_ids: [issue],
			fixes_deployed: [{ issue_id: issue, outcome: "regressed" }],
		});
		const outcomes = await listFixOutcomes(ports.db, { limit: 10 }, new Date());
		expect(outcomes).toEqual([
			expect.objectContaining({ issue_id: issue, outcome: "regressed", hours_to_verified: 25 }),
		]);
	});
});
