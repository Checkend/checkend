import { describe, expect, it } from "vitest";
import { IngestState } from "../../../src/core/ingest/state.ts";
import {
	createAgentToken,
	registerApp,
	reportSetupStep,
	sendTestEvent,
} from "../../../src/core/setup.ts";
import {
	authenticateSetupKey,
	createSetupKey,
	MAX_APPS_PER_KEY,
	MAX_TOKENS_PER_KEY,
} from "../../../src/core/setup-keys.ts";
import { authenticate, BOOTSTRAP_ADMIN } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";

async function withKey() {
	const t = await testPorts();
	const { key } = await createSetupKey(t.ports, BOOTSTRAP_ADMIN);
	const actor = await authenticateSetupKey(t.ports, `Bearer ${key}`);
	if (!actor) throw new Error("no actor");
	return { ...t, actor };
}

describe("registerApp", () => {
	it("creates the project and its setup row with the key, and writes activity as the key", async () => {
		const { ports, actor } = await withKey();
		const app = await registerApp(ports, actor, { name: "shop-api", platform: "node" });
		expect(app).toMatchObject({
			created: true,
			project: { name: "shop-api", slug: "shop-api", platform: "node" },
		});
		expect(app.ok && app.public_key).toMatch(/^[0-9a-f]{32}$/);
		expect(await ports.db.first(sql`SELECT setup_key_id, connected_at FROM project_setup`)).toEqual(
			{
				setup_key_id: actor.id,
				connected_at: "2026-10-10T12:00:00.000Z",
			},
		);
		expect(
			await ports.db.first(
				sql`SELECT actor_type, action FROM activity WHERE action = 'project.create'`,
			),
		).toEqual({
			actor_type: "setup_key",
			action: "project.create",
		});
	});

	it("returns the same app on a retry with the same name (the same key)", async () => {
		const { ports, actor } = await withKey();
		const first = await registerApp(ports, actor, { name: "shop-api" });
		const again = await registerApp(ports, actor, { name: "shop-api" });
		expect(again).toMatchObject({ ok: true, created: false });
		expect(again.ok && again.project.id).toBe(first.ok && first.project.id);
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM projects`)).toEqual({ n: 1 });
	});

	it("stops at the app limit of a key", async () => {
		const { ports, actor } = await withKey();
		for (let i = 0; i < MAX_APPS_PER_KEY; i++)
			await registerApp(ports, actor, { name: `app ${i}` });
		expect(await registerApp(ports, actor, { name: "one more" })).toEqual({
			ok: false,
			error: "limit",
		});
	});
});

describe("createAgentToken", () => {
	it("creates an issues:read issues:write token for an app of the key", async () => {
		const { ports, actor } = await withKey();
		const app = await registerApp(ports, actor, { name: "shop-api" });
		if (!app.ok) throw new Error();
		const made = await createAgentToken(ports, actor, {
			name: "Claude Code",
			project: String(app.project.id),
		});
		if (!made.ok) throw new Error(made.error);
		expect(made.record.scopes).toEqual(["issues:read", "issues:write"]);
		const agent = await authenticate(ports, `Bearer ${made.token}`);
		expect(agent?.scopes).toEqual(["issues:read", "issues:write"]);
		expect(
			await ports.db.first(sql`SELECT setup_key_id, project_id IS NOT NULL AS linked FROM tokens`),
		).toEqual({
			setup_key_id: actor.id,
			linked: 1,
		});
	});

	it("refuses an app of another key, and stops at the token limit", async () => {
		const { ports, actor } = await withKey();
		const other = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		const otherActor = await authenticateSetupKey(ports, `Bearer ${other.key}`);
		const theirs = await registerApp(ports, otherActor ?? actor, { name: "theirs" });
		if (!theirs.ok) throw new Error();
		expect(
			await createAgentToken(ports, actor, { name: "x", project: theirs.project.slug }),
		).toEqual({
			ok: false,
			error: "not_found",
		});
		const mine = await registerApp(ports, actor, { name: "mine" });
		if (!mine.ok) throw new Error();
		for (let i = 0; i < MAX_TOKENS_PER_KEY; i++) {
			expect(
				(await createAgentToken(ports, actor, { name: `t${i}`, project: mine.project.slug })).ok,
			).toBe(true);
		}
		expect(
			await createAgentToken(ports, actor, { name: "more", project: mine.project.slug }),
		).toEqual({
			ok: false,
			error: "limit",
		});
	});
});

describe("sendTestEvent and reportSetupStep", () => {
	it("sends one test event per app, marked as a test", async () => {
		const { ports, actor } = await withKey();
		const app = await registerApp(ports, actor, { name: "shop-api" });
		if (!app.ok) throw new Error();
		const state = new IngestState();
		expect(await sendTestEvent(ports, state, actor, app.project.slug)).toEqual({ ok: true });
		expect(await sendTestEvent(ports, state, actor, app.project.slug)).toEqual({
			ok: false,
			error: "already_sent",
		});
		const issue = await ports.db.first<{ title: string; data: string }>(
			sql`SELECT i.title, e.data FROM issues i JOIN events e ON e.issue_id = i.id`,
		);
		expect(issue?.title).toContain("Checkend test event");
		expect(JSON.parse(issue?.data ?? "{}").tags).toContainEqual(["checkend.test", "true"]);
		expect(await ports.db.first(sql`SELECT test_event_at FROM project_setup`)).toEqual({
			test_event_at: "2026-10-10T12:00:00.000Z",
		});
	});

	it("records the SDK report once, and only for an app of the key", async () => {
		const { ports, actor, clock } = await withKey();
		const app = await registerApp(ports, actor, { name: "shop-api" });
		if (!app.ok) throw new Error();
		expect(await reportSetupStep(ports, actor, app.project.slug, "sdk_installed")).toBe("ok");
		clock.advance(60_000);
		expect(await reportSetupStep(ports, actor, app.project.slug, "sdk_installed")).toBe("ok");
		expect(await ports.db.first(sql`SELECT sdk_installed_at FROM project_setup`)).toEqual({
			sdk_installed_at: "2026-10-10T12:00:00.000Z",
		});
		expect(await reportSetupStep(ports, actor, "nope", "sdk_installed")).toBe("not_found");
	});
});

describe("the setup key limits under parallel requests", () => {
	it("stops at 10 apps and 5 tokens, also when the requests run at the same time", async () => {
		const { ports, actor } = await withKey();
		const apps = await Promise.all(
			Array.from({ length: 15 }, (_, i) => registerApp(ports, actor, { name: `parallel ${i}` })),
		);
		expect(apps.filter((a) => a.ok)).toHaveLength(MAX_APPS_PER_KEY);
		expect(apps.filter((a) => !a.ok)).toEqual(
			Array.from({ length: 5 }, () => ({ ok: false, error: "limit" })),
		);
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM projects`)).toEqual({
			n: MAX_APPS_PER_KEY,
		});
		expect(
			await ports.db.first(sql`SELECT count(*) AS n FROM activity WHERE action = 'project.create'`),
		).toEqual({
			n: MAX_APPS_PER_KEY,
		});
		const first = apps.find((a) => a.ok);
		if (!first?.ok) throw new Error();
		const tokens = await Promise.all(
			Array.from({ length: 8 }, (_, i) =>
				createAgentToken(ports, actor, { name: `t${i}`, project: first.project.slug }),
			),
		);
		expect(tokens.filter((t) => t.ok)).toHaveLength(MAX_TOKENS_PER_KEY);
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM tokens`)).toEqual({
			n: MAX_TOKENS_PER_KEY,
		});
	});
});
