import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";

/** Sign-in and setup attempts per client in one window. */
export const AUTH_ATTEMPT_LIMIT = 20;
export const AUTH_ATTEMPT_WINDOW_MS = 15 * 60_000;

/**
 * Counts one sign-in or setup attempt for `client` (the client IP). Returns false above the
 * limit. Fixed windows in D1, so the limit works without an optional rate-limit binding.
 */
export async function allowAuthAttempt(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	client: string,
): Promise<boolean> {
	const now = clock.now().getTime();
	const windowStart = new Date(now - (now % AUTH_ATTEMPT_WINDOW_MS)).toISOString();
	const key = client.slice(0, 64);
	const [, upsert] = await db.batch([
		sql`DELETE FROM auth_attempts WHERE window_start < ${windowStart}`,
		sql`INSERT INTO auth_attempts (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
			ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
			RETURNING count`,
	]);
	return Number(upsert?.rows[0]?.count ?? 0) <= AUTH_ATTEMPT_LIMIT;
}
