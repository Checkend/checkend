import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";

/** Sign-in and setup attempts per client in one window. */
export const AUTH_ATTEMPT_LIMIT = 20;
/** Attempts of all clients together in one window: a ceiling for D1 writes. */
export const AUTH_GLOBAL_LIMIT = 500;
export const AUTH_ATTEMPT_WINDOW_MS = 15 * 60_000;

const ALL_CLIENTS = "*";

/**
 * Counts one sign-in or setup attempt for `client` (see `clientKey`). Returns false above
 * the limit of the client, or above the limit of all clients together. Fixed windows in D1,
 * so the limit works without an optional rate-limit binding. A refused attempt writes
 * nothing: a client over the limit cannot use up the D1 daily write budget.
 */
export async function allowAuthAttempt(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	client: string,
): Promise<boolean> {
	const now = clock.now().getTime();
	const windowStart = new Date(now - (now % AUTH_ATTEMPT_WINDOW_MS)).toISOString();
	const key = client.slice(0, 64);
	const counts = await db.all<{ key: string; count: number }>(
		sql`SELECT key, count FROM auth_attempts
			WHERE window_start = ${windowStart} AND key IN (${key}, ${ALL_CLIENTS})`,
	);
	const countOf = (k: string) => counts.find((row) => row.key === k)?.count ?? 0;
	if (countOf(key) >= AUTH_ATTEMPT_LIMIT || countOf(ALL_CLIENTS) >= AUTH_GLOBAL_LIMIT) {
		return false;
	}
	await db.batch([
		sql`DELETE FROM auth_attempts WHERE window_start < ${windowStart}`,
		sql`INSERT INTO auth_attempts (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
			ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1`,
		sql`INSERT INTO auth_attempts (key, window_start, count) VALUES (${ALL_CLIENTS}, ${windowStart}, 1)
			ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1`,
	]);
	return true;
}
