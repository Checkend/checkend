import * as v from "valibot";
import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import { prepareEvent } from "./ingest/prepare.ts";
import type { IngestState } from "./ingest/state.ts";
import { storeEvent } from "./ingest/store.ts";
import { createProject } from "./projects.ts";
import { MAX_APPS_PER_KEY, MAX_TOKENS_PER_KEY } from "./setup-keys.ts";
import { type Actor, createToken, hasScope, type TokenRecord } from "./tokens.ts";

/**
 * What an agent does with a setup key (onboarding, D20): register apps, create agent tokens,
 * send one test event per app, and report steps. An admin token can do the same for any app.
 */
type SetupPorts = Pick<Ports, "db" | "clock">;

export const RegisterAppBody = v.strictObject({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	platform: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(32)))),
});

export const AgentTokenBody = v.strictObject({
	/** The agent, for example "Claude Code". */
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	/** The public ID or the slug of an app of this key. */
	project: v.pipe(v.string(), v.minLength(1), v.maxLength(64)),
});

export type SetupApp = {
	id: number;
	slug: string;
	name: string;
	platform: string | null;
};

export type RegisterResult =
	| { ok: true; created: boolean; project: SetupApp; public_key: string }
	| { ok: false; error: "limit" | "forbidden" };

/** Setup keys work on their own apps; an admin on every app. */
async function appOf(
	db: SetupPorts["db"],
	actor: Actor,
	ref: string,
): Promise<{ internalId: number; publicId: number } | null> {
	const row = await db.first<{ id: number; public_id: number; setup_key_id: number | null }>(
		sql`SELECT p.id, p.public_id, s.setup_key_id FROM projects p
			LEFT JOIN project_setup s ON s.project_id = p.id
			WHERE (p.public_id = ${/^\d{10}$/.test(ref) ? Number(ref) : null} OR p.slug = ${ref})
				AND p.deleted_at IS NULL`,
	);
	if (!row) return null;
	const allowed =
		actor.type === "setup_key" ? row.setup_key_id === actor.id : hasScope(actor, "admin");
	return allowed ? { internalId: row.id, publicId: row.public_id } : null;
}

const canSetUp = (actor: Actor) => actor.type === "setup_key" || hasScope(actor, "admin");

/** Registers an app (a project). A retry with the same name returns the app of this key. */
export async function registerApp(
	ports: SetupPorts,
	actor: Actor,
	input: { name: string; platform?: string | null | undefined },
): Promise<RegisterResult> {
	if (!canSetUp(actor)) return { ok: false, error: "forbidden" };
	const keyId = actor.type === "setup_key" ? actor.id : null;
	if (keyId !== null) {
		const existing = await ports.db.first<SetupApp & { public_key: string }>(
			sql`SELECT p.public_id AS id, p.slug, p.name, p.platform,
					(SELECT k.public_key FROM project_keys k WHERE k.project_id = p.id AND k.revoked_at IS NULL
						ORDER BY k.id LIMIT 1) AS public_key
				FROM project_setup s JOIN projects p ON p.id = s.project_id
				WHERE s.setup_key_id = ${keyId} AND p.name = ${input.name.trim()} AND p.deleted_at IS NULL`,
		);
		if (existing) {
			const { public_key, ...project } = existing;
			return { ok: true, created: false, project, public_key };
		}
		const count = await ports.db.first<{ n: number }>(
			sql`SELECT count(*) AS n FROM project_setup WHERE setup_key_id = ${keyId}`,
		);
		if ((count?.n ?? 0) >= MAX_APPS_PER_KEY) return { ok: false, error: "limit" };
	}
	const created = await createProject(
		ports,
		{
			name: input.name,
			platform: input.platform ?? null,
			...(keyId === null ? {} : { setupKeyId: keyId }),
		},
		actor,
	);
	if (keyId === null) {
		// An admin: the setup row without a key, so that the app shows in the progress.
		await ports.db.run(
			sql`INSERT INTO project_setup (project_id, connected_at) VALUES (${created.internalId}, ${created.createdAt})
				ON CONFLICT (project_id) DO NOTHING`,
		);
	}
	return {
		ok: true,
		created: true,
		project: { id: created.id, slug: created.slug, name: created.name, platform: created.platform },
		public_key: created.publicKey,
	};
}

export type AgentTokenResult =
	| { ok: true; token: string; record: TokenRecord }
	| { ok: false; error: "not_found" | "limit" | "forbidden" };

/** An agent token (issues:read, issues:write) for an app. Never other scopes. */
export async function createAgentToken(
	ports: SetupPorts,
	actor: Actor,
	input: { name: string; project: string },
): Promise<AgentTokenResult> {
	if (!canSetUp(actor)) return { ok: false, error: "forbidden" };
	const app = await appOf(ports.db, actor, input.project);
	if (!app) return { ok: false, error: "not_found" };
	if (actor.type === "setup_key") {
		const count = await ports.db.first<{ n: number }>(
			sql`SELECT count(*) AS n FROM tokens WHERE setup_key_id = ${actor.id}`,
		);
		if ((count?.n ?? 0) >= MAX_TOKENS_PER_KEY) return { ok: false, error: "limit" };
	}
	const { token, record } = await createToken(
		ports,
		actor,
		{ name: input.name, scopes: ["issues:read", "issues:write"] },
		{ setupKeyId: actor.type === "setup_key" ? actor.id : null, projectId: app.internalId },
	);
	return { ok: true, token, record };
}

export const TEST_EVENT_MESSAGE =
	"Checkend test event: the setup works. This is a test; you can resolve this issue.";

/** One test event per app, marked with the tag checkend.test=true. */
export async function sendTestEvent(
	ports: SetupPorts & Pick<Ports, "config">,
	state: IngestState,
	actor: Actor,
	project: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "already_sent" }> {
	const app = await appOf(ports.db, actor, project);
	if (!app) return { ok: false, error: "not_found" };
	const now = ports.clock.now();
	// Claim the one test event first, so that two calls at once send one event.
	const claimed = await ports.db.run(
		sql`UPDATE project_setup SET test_event_at = ${now.toISOString()}
			WHERE project_id = ${app.internalId} AND test_event_at IS NULL`,
	);
	if (claimed.changes === 0) return { ok: false, error: "already_sent" };
	const raw = JSON.stringify({
		message: TEST_EVENT_MESSAGE,
		level: "info",
		tags: { "checkend.test": "true" },
	});
	await storeEvent(
		ports,
		state,
		app.internalId,
		await prepareEvent(new TextEncoder().encode(raw), now),
	);
	await ports.db.run(
		activityStatement(actor, "setup.test_event", { type: "project", id: app.publicId }, null, now),
	);
	return { ok: true };
}

export const SETUP_STEPS = ["sdk_installed"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];
export const ReportBody = v.strictObject({ step: v.picklist(SETUP_STEPS) });

/** A step that the agent reports. The first report counts. */
/**
 * The app of an agent token that a setup key made (tokens.project_id): `ce setup report` runs
 * with that token, also after the key expired. Only its own app; nothing else changes for it.
 */
async function appOfAgentToken(
	db: SetupPorts["db"],
	actor: Actor,
	ref: string,
): Promise<{ internalId: number; publicId: number } | null> {
	const row = await db.first<{ id: number; public_id: number }>(
		sql`SELECT p.id, p.public_id FROM tokens t JOIN projects p ON p.id = t.project_id
			WHERE t.id = ${actor.id} AND t.setup_key_id IS NOT NULL AND t.revoked_at IS NULL
				AND (p.public_id = ${/^\d{10}$/.test(ref) ? Number(ref) : null} OR p.slug = ${ref})
				AND p.deleted_at IS NULL`,
	);
	return row ? { internalId: row.id, publicId: row.public_id } : null;
}

/**
 * A step that the agent reports. The first report counts. A setup key or an admin: their apps;
 * an agent token of a setup key: its own app ("forbidden" for any other).
 */
export async function reportSetupStep(
	ports: SetupPorts,
	actor: Actor,
	project: string,
	step: SetupStep,
): Promise<"ok" | "not_found" | "forbidden"> {
	const agentToken = actor.type === "token" && !hasScope(actor, "admin");
	const app = agentToken
		? await appOfAgentToken(ports.db, actor, project)
		: await appOf(ports.db, actor, project);
	if (!app) return agentToken ? "forbidden" : "not_found";
	const now = ports.clock.now();
	await ports.db.batch([
		sql`UPDATE project_setup SET sdk_installed_at = coalesce(sdk_installed_at, ${now.toISOString()})
			WHERE project_id = ${app.internalId}`,
		activityStatement(actor, "setup.report", { type: "project", id: app.publicId }, { step }, now),
	]);
	return "ok";
}
