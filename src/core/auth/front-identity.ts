import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { randomToken, SESSION_TTL_MS, type Session } from "./sessions.ts";

/**
 * The trusted front identity of a hosted install. The front Worker signs people in (its own
 * passkeys and session cookie) and passes the member identity with its call to the install: an
 * argument of the call, never a request header, so that a browser cannot send one. The install
 * then has no sign-in of its own (config.trustedFront).
 */
export interface FrontIdentity {
	/** The account at the front Worker: opaque, stable. */
	accountId: string;
	/** The name to show, for example in the activity timeline. */
	name: string;
	/** The role in this space. Both roles are members of the install (all members are admins). */
	role: "owner" | "member";
}

const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The identity, or null when it is not well formed. */
export function parseFrontIdentity(value: unknown): FrontIdentity | null {
	if (!value || typeof value !== "object") return null;
	const { accountId, name, role } = value as Record<string, unknown>;
	if (typeof accountId !== "string" || !ACCOUNT_ID.test(accountId)) return null;
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	if (trimmed.length === 0 || trimmed.length > 100) return null;
	if (role !== "owner" && role !== "member") return null;
	return { accountId, name: trimmed, role };
}

/**
 * The member of an identity: created on first use, renamed when the name changes. Its user
 * handle is `front:<account ID>` (the handles of passkey members never contain a colon).
 */
const handleOf = (identity: FrontIdentity) => `front:${identity.accountId}`;

/**
 * The session of a front identity: the member and a CSRF token for its forms. There is no
 * cookie: the row only keeps the CSRF token, and its ID is a random value that nobody gets.
 */
export async function frontSession(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	identity: FrontIdentity,
): Promise<Session> {
	const now = clock.now();
	const nowIso = now.toISOString();
	const handle = handleOf(identity);
	const find = () =>
		db.first<{ member_id: number; name: string; csrf_token: string; expires_at: string }>(
			sql`SELECT m.id AS member_id, m.name, s.csrf_token, s.expires_at
				FROM members m JOIN sessions s ON s.member_id = m.id
				WHERE m.user_handle = ${handle} AND s.expires_at > ${nowIso}
				ORDER BY s.expires_at DESC LIMIT 1`,
		);
	let row = await find();
	// A new session when the last one is older than half its life: the CSRF token rotates.
	const fresh = row && Date.parse(row.expires_at) - now.getTime() > SESSION_TTL_MS / 2 ? row : null;
	if (!fresh) {
		const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
		await db.batch([
			sql`INSERT INTO members (name, user_handle, created_at)
				SELECT ${identity.name}, ${handle}, ${nowIso}
				WHERE NOT EXISTS (SELECT 1 FROM members WHERE user_handle = ${handle})`,
			sql`DELETE FROM sessions WHERE expires_at <= ${nowIso}`,
			sql`INSERT INTO sessions (id_hash, member_id, csrf_token, created_at, expires_at)
				SELECT ${`front:${randomToken()}`}, id, ${randomToken()}, ${nowIso}, ${expiresAt}
				FROM members WHERE user_handle = ${handle}`,
		]);
		row = await find();
	}
	if (!row) throw new Error("checkend: the member of a front identity was not stored");
	if (row.name !== identity.name) {
		await db.run(sql`UPDATE members SET name = ${identity.name} WHERE user_handle = ${handle}`);
	}
	return {
		memberId: row.member_id,
		memberName: identity.name,
		csrfToken: row.csrf_token,
		expiresAt: row.expires_at,
	};
}
