import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../../src/core/ingest/prepare.ts";
import { IngestState } from "../../../src/core/ingest/state.ts";
import { storeEvent } from "../../../src/core/ingest/store.ts";
import { createProject } from "../../../src/core/projects.ts";
import {
	createAgentToken,
	registerApp,
	reportSetupStep,
	sendTestEvent,
} from "../../../src/core/setup.ts";
import { authenticateSetupKey, createSetupKey } from "../../../src/core/setup-keys.ts";
import { onboardingProgress, recordMcpCall } from "../../../src/core/setup-progress.ts";
import { BOOTSTRAP_ADMIN } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";

describe("onboardingProgress", () => {
	it("follows an app from registration to the first deploy", async () => {
		const { ports, clock } = await testPorts();
		const key = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		const actor = await authenticateSetupKey(ports, `Bearer ${key.key}`);
		if (!actor) throw new Error();
		const app = await registerApp(ports, actor, { name: "shop-api", platform: "node" });
		if (!app.ok) throw new Error();
		const at = (minutes: number) =>
			new Date(Date.parse("2026-10-10T12:00:00Z") + minutes * 60_000).toISOString();

		let progress = await onboardingProgress(ports.db, clock.now());
		expect(progress).toEqual({
			setup_keys_active: 1,
			apps: [
				{
					project: { ...app.project, demo: false },
					connected_at: at(0),
					sdk_installed_at: null,
					test_event_at: null,
					first_event_at: null,
					agent: null,
					first_deploy_at: null,
				},
			],
		});

		clock.advance(60_000);
		await reportSetupStep(ports, actor, app.project.slug, "sdk_installed");
		await sendTestEvent(ports, new IngestState(), actor, app.project.slug);
		const made = await createAgentToken(ports, actor, {
			name: "Claude Code",
			project: app.project.slug,
		});
		if (!made.ok) throw new Error();
		clock.advance(60_000);
		await recordMcpCall(ports, made.record.id, "claude-code");
		await recordMcpCall(ports, made.record.id, "other-name");
		const internal = (await ports.db.first<{ id: number }>(sql`SELECT id FROM projects`))?.id ?? 0;
		clock.advance(60_000);
		const prepared = await prepareEvent(
			new TextEncoder().encode('{"message":"real error"}'),
			clock.now(),
		);
		await storeEvent(ports, new IngestState(), internal, prepared);
		await ports.db.run(
			sql`INSERT INTO releases (project_id, version, created_at) VALUES (${internal}, 'v1', ${at(3)})`,
		);
		await ports.db.run(
			sql`INSERT INTO deploys (uid, project_id, release_id, environment, commit_sha, source, deployed_at)
				VALUES ('d1', ${internal}, (SELECT id FROM releases), 'production', 'abc', 'api', ${at(4)})`,
		);

		progress = await onboardingProgress(ports.db, clock.now());
		expect(progress.apps[0]).toMatchObject({
			sdk_installed_at: at(1),
			test_event_at: at(1),
			first_event_at: at(3),
			agent: { name: "claude-code", at: at(2) },
			first_deploy_at: at(4),
		});
	});

	it("lists apps without a setup row, marks the demo, and hides deleted apps", async () => {
		const { ports, clock } = await testPorts();
		await createProject(ports, { name: "Demo", demo: true });
		await createProject(ports, { name: "Gone" });
		await ports.db.run(
			sql`UPDATE projects SET deleted_at = ${clock.now().toISOString()} WHERE name = 'Gone'`,
		);
		const progress = await onboardingProgress(ports.db, clock.now());
		expect(progress.setup_keys_active).toBe(0);
		expect(progress.apps).toEqual([
			expect.objectContaining({
				project: expect.objectContaining({ name: "Demo", demo: true }),
				connected_at: "2026-10-10T12:00:00.000Z",
			}),
		]);
	});

	it("for a setup key: only the apps of that key", async () => {
		const { ports, clock } = await testPorts();
		await createProject(ports, { name: "Other" });
		const key = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		const actor = await authenticateSetupKey(ports, `Bearer ${key.key}`);
		if (!actor?.id) throw new Error();
		await registerApp(ports, actor, { name: "mine" });
		const progress = await onboardingProgress(ports.db, clock.now(), { setupKeyId: actor.id });
		expect(progress.apps.map((a) => a.project.name)).toEqual(["mine"]);
	});
});
