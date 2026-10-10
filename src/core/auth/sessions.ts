import { type Statement, sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";

/** A session ends 14 days after sign-in. */
export const SESSION_TTL_MS = 14 * 24 * 3600_000;

export interface NewSession {
	/** The session ID for the cookie. Only its hash is stored. */
	token: string;
	expiresAt: Date;
}

export interface Session {
	memberId: number;
	memberName: string;
	csrfToken: string;
	expiresAt: string;
}

const hex = (bytes: ArrayBuffer) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export const sha256Hex = async (text: string) =>
	hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/** 32 random bytes, base64url (43 characters). */
export function randomToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A new session for the member with this user handle. Returns the statements, so that the
 * caller can put them in its own atomic batch (for example with the member insert).
 */
export async function sessionStatements(
	userHandle: string,
	now: Date,
): Promise<{ session: NewSession; statements: Statement[] }> {
	const token = randomToken();
	const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
	const nowIso = now.toISOString();
	return {
		session: { token, expiresAt },
		statements: [
			sql`DELETE FROM sessions WHERE expires_at <= ${nowIso}`,
			sql`INSERT INTO sessions (id_hash, member_id, csrf_token, created_at, expires_at)
				SELECT ${await sha256Hex(token)}, id, ${randomToken()}, ${nowIso}, ${expiresAt.toISOString()}
				FROM members WHERE user_handle = ${userHandle}`,
		],
	};
}

/** The session of a cookie value, or null when it is unknown or expired. */
export async function getSession(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	token: string,
): Promise<Session | null> {
	if (!TOKEN.test(token)) return null;
	const row = await db.first<{
		member_id: number;
		name: string;
		csrf_token: string;
		expires_at: string;
	}>(
		sql`SELECT s.member_id, m.name, s.csrf_token, s.expires_at
			FROM sessions s JOIN members m ON m.id = s.member_id
			WHERE s.id_hash = ${await sha256Hex(token)} AND s.expires_at > ${clock.now().toISOString()}`,
	);
	if (!row) return null;
	return {
		memberId: row.member_id,
		memberName: row.name,
		csrfToken: row.csrf_token,
		expiresAt: row.expires_at,
	};
}

/** Sign-out: deletes the session. */
export async function deleteSession({ db }: Pick<Ports, "db">, token: string): Promise<void> {
	if (!TOKEN.test(token)) return;
	await db.run(sql`DELETE FROM sessions WHERE id_hash = ${await sha256Hex(token)}`);
}

export const DEV_MEMBER_NAME = "Developer (local)";

/**
 * Development only (the HTTP route checks the flag): a session for a local member without a
 * passkey. The member is created the first time.
 */
export async function createDevSession({ db, clock }: Pick<Ports, "db" | "clock">) {
	const now = clock.now();
	const existing = await db.first<{ user_handle: string }>(
		sql`SELECT user_handle FROM members WHERE name = ${DEV_MEMBER_NAME} ORDER BY id LIMIT 1`,
	);
	const userHandle = existing?.user_handle ?? randomToken();
	const { session, statements } = await sessionStatements(userHandle, now);
	const create = existing
		? []
		: [
				sql`INSERT INTO members (name, user_handle, created_at)
					VALUES (${DEV_MEMBER_NAME}, ${userHandle}, ${now.toISOString()})`,
			];
	await db.batch([...create, ...statements]);
	return session;
}
