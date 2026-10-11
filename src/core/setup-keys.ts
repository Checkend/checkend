import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { type Actor, newSecret, sha256 } from "./tokens.ts";

/**
 * Setup keys (cks_...): an agent connects apps with one (onboarding, D20). A key is valid for one
 * hour and can be revoked. It can only register apps, create agent tokens (issues:read and
 * issues:write), send one test event per app and report progress: never settings, other tokens
 * or deletes. Only its hash is stored, and each use writes activity.
 */
export const SETUP_KEY_TTL_MS = 3_600_000;
/** Apps that one key can register. */
export const MAX_APPS_PER_KEY = 10;
/** Agent tokens that one key can create. */
export const MAX_TOKENS_PER_KEY = 5;

export interface CreatedSetupKey {
	id: number;
	/** Shown once; never stored. */
	key: string;
	expires_at: string;
}

export interface SetupKeyRecord {
	id: number;
	prefix: string;
	created_at: string;
	created_by: string;
	expires_at: string;
	revoked_at: string | null;
	/** Not expired and not revoked. */
	active: boolean;
	/** Apps registered with this key. */
	apps: number;
}

export async function createSetupKey(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	actor: Actor,
): Promise<CreatedSetupKey> {
	const key = newSecret("cks_");
	const now = clock.now();
	const expiresAt = new Date(now.getTime() + SETUP_KEY_TTL_MS).toISOString();
	const keyHash = await sha256(key);
	const [inserted] = await db.batch([
		sql`INSERT INTO setup_keys (key_hash, prefix, created_at, created_by, expires_at)
			VALUES (${keyHash}, ${key.slice(0, 8)}, ${now.toISOString()}, ${actor.name}, ${expiresAt})
			RETURNING id`,
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${now.toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, ${"setup_key.create"},
				${"setup_key"}, id, ${JSON.stringify({ expires_at: expiresAt })}
			FROM setup_keys WHERE key_hash = ${keyHash}`,
	]);
	return { id: Number(inserted?.rows[0]?.id), key, expires_at: expiresAt };
}

/** Revokes a key. False when it does not exist or is already revoked. */
export async function revokeSetupKey(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	actor: Actor,
	id: number,
): Promise<boolean> {
	const now = clock.now();
	const [, update] = await db.batch([
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${now.toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, ${"setup_key.revoke"},
				${"setup_key"}, id, NULL
			FROM setup_keys WHERE id = ${id} AND revoked_at IS NULL`,
		sql`UPDATE setup_keys SET revoked_at = ${now.toISOString()} WHERE id = ${id} AND revoked_at IS NULL`,
	]);
	return (update?.changes ?? 0) > 0;
}

/** All keys, the newest first. */
export async function listSetupKeys(db: Db, now: Date): Promise<SetupKeyRecord[]> {
	const rows = await db.all<Omit<SetupKeyRecord, "active">>(
		sql`SELECT k.id, k.prefix, k.created_at, k.created_by, k.expires_at, k.revoked_at,
				(SELECT count(*) FROM project_setup s WHERE s.setup_key_id = k.id) AS apps
			FROM setup_keys k ORDER BY k.id DESC`,
	);
	const at = now.toISOString();
	return rows.map((row) => ({ ...row, active: row.revoked_at === null && row.expires_at > at }));
}

/** The actor of a setup key in `Authorization: Bearer cks_...`, or null. */
export async function authenticateSetupKey(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	authorization: string | null,
): Promise<Actor | null> {
	const key = /^Bearer\s+(cks_\S+)\s*$/i.exec(authorization ?? "")?.[1];
	if (!key) return null;
	const row = await db.first<{ id: number; prefix: string }>(
		sql`SELECT id, prefix FROM setup_keys WHERE key_hash = ${await sha256(key)}
			AND revoked_at IS NULL AND expires_at > ${clock.now().toISOString()}`,
	);
	return row
		? { type: "setup_key", id: row.id, name: `setup key ${row.prefix}`, scopes: [] }
		: null;
}
