import * as v from "valibot";
import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

/** API scopes. `admin` includes all the others. */
export const SCOPES = ["issues:read", "issues:write", "releases:write", "admin"] as const;
export type Scope = (typeof SCOPES)[number];

export const CreateTokenBody = v.object({
	name: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(100)),
	scopes: v.pipe(v.array(v.picklist(SCOPES)), v.minLength(1), v.maxLength(SCOPES.length)),
});

/** Who makes a request: a scoped token, or the bootstrap ADMIN_TOKEN secret. */
export interface Actor {
	/**
	 * "system": Checkend itself (for example ingest, when it reopens a resolved issue).
	 * "setup_key": an agent with a setup key (only the /v1/setup routes; no scopes).
	 */
	type: "token" | "admin_token" | "system" | "setup_key";
	id: number | null;
	name: string;
	scopes: Scope[];
}

export const BOOTSTRAP_ADMIN: Actor = {
	type: "admin_token",
	id: null,
	name: "ADMIN_TOKEN",
	scopes: ["admin"],
};

export const hasScope = (actor: Actor, scope: Scope): boolean =>
	actor.scopes.includes("admin") || actor.scopes.includes(scope);

const hex = (bytes: ArrayBuffer | Uint8Array) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256 = async (text: string) =>
	hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** A random secret: the prefix and 32 random bytes as base64url. */
export function newSecret(prefix: string): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const base64 = btoa(String.fromCharCode(...bytes));
	return `${prefix}${base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

const newToken = () => newSecret("ck_");

export interface TokenRecord {
	id: number;
	name: string;
	scopes: Scope[];
	prefix: string;
	created_at: string;
	created_by: string;
	last_used_at: string | null;
	revoked_at: string | null;
}

/** Creates a token. The token itself is returned once and never stored. */
export async function createToken(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	actor: Actor,
	input: { name: string; scopes: readonly string[] },
	/** An agent token made with a setup key, for one app (onboarding progress). */
	link?: { setupKeyId: number | null; projectId: number },
): Promise<{ token: string; record: TokenRecord }> {
	const name = input.name.trim();
	if (name.length === 0 || name.length > 100)
		throw new RangeError("A token name must have 1 to 100 characters.");
	const scopes = [...new Set(input.scopes)];
	if (
		scopes.length === 0 ||
		!scopes.every((s): s is Scope => (SCOPES as readonly string[]).includes(s))
	) {
		throw new RangeError(`Each scope must be one of: ${SCOPES.join(", ")}.`);
	}
	const token = newToken();
	const now = clock.now();
	const createdAt = now.toISOString();
	const tokenHash = await sha256(token);
	const prefix = token.slice(0, 10);
	const [inserted] = await db.batch([
		sql`INSERT INTO tokens (name, scopes, token_hash, prefix, created_at, created_by, setup_key_id, project_id)
			VALUES (${name}, ${scopes.join(" ")}, ${tokenHash}, ${prefix}, ${createdAt}, ${actor.name},
				${link?.setupKeyId ?? null}, ${link?.projectId ?? null})
			RETURNING id`,
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${createdAt}, ${actor.type}, ${actor.id}, ${actor.name}, ${"token.create"}, ${"token"}, id,
				${JSON.stringify({ name, scopes })}
			FROM tokens WHERE token_hash = ${tokenHash}`,
	]);
	const id = Number(inserted?.rows[0]?.id);
	return {
		token,
		record: {
			id,
			name,
			scopes,
			prefix,
			created_at: createdAt,
			created_by: actor.name,
			last_used_at: null,
			revoked_at: null,
		},
	};
}

const LAST_USED_INTERVAL_MS = 3600_000;

/**
 * The actor of an `Authorization: Bearer ...` header, or null. The bootstrap ADMIN_TOKEN is
 * compared in constant time; other tokens are found by their SHA-256 hash. The last use is
 * written at most once per hour (in defer), to save D1 writes.
 */
export async function authenticate(
	{ db, clock, config, defer }: Pick<Ports, "db" | "clock" | "config" | "defer">,
	authorization: string | null,
): Promise<Actor | null> {
	const token = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1];
	if (!token) return null;
	const tokenHash = await sha256(token);
	if (config.adminToken && constantTimeEqual(tokenHash, await sha256(config.adminToken))) {
		return BOOTSTRAP_ADMIN;
	}
	if (!token.startsWith("ck_")) return null;
	const row = await db.first<{
		id: number;
		name: string;
		scopes: string;
		last_used_at: string | null;
	}>(
		sql`SELECT id, name, scopes, last_used_at FROM tokens WHERE token_hash = ${tokenHash} AND revoked_at IS NULL`,
	);
	if (!row) return null;
	const now = clock.now();
	if (!row.last_used_at || now.getTime() - Date.parse(row.last_used_at) >= LAST_USED_INTERVAL_MS) {
		defer(
			db
				.run(sql`UPDATE tokens SET last_used_at = ${now.toISOString()} WHERE id = ${row.id}`)
				.catch(() => {}),
		);
	}
	return { type: "token", id: row.id, name: row.name, scopes: row.scopes.split(" ") as Scope[] };
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}

export async function listTokens(db: Db): Promise<TokenRecord[]> {
	const rows = await db.all<Omit<TokenRecord, "scopes"> & { scopes: string }>(
		sql`SELECT id, name, scopes, prefix, created_at, created_by, last_used_at, revoked_at FROM tokens ORDER BY id`,
	);
	return rows.map((row) => ({ ...row, scopes: row.scopes.split(" ") as Scope[] }));
}

/** Revokes a token. Returns false when it does not exist or is already revoked. */
export async function revokeToken(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	actor: Actor,
	id: number,
): Promise<boolean> {
	const now = clock.now();
	// The activity row first, while the token is still active; then the revoke.
	const [, update] = await db.batch([
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${now.toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, ${"token.revoke"}, ${"token"}, id, NULL
			FROM tokens WHERE id = ${id} AND revoked_at IS NULL`,
		sql`UPDATE tokens SET revoked_at = ${now.toISOString()} WHERE id = ${id} AND revoked_at IS NULL`,
	]);
	return (update?.changes ?? 0) > 0;
}
