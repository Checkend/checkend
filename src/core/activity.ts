import { type Db, type Statement, sql } from "../ports/db.ts";
import type { Actor } from "./tokens.ts";

/**
 * The audit timeline: every write by every actor. The statement goes into the same atomic
 * batch as the write, so the timeline cannot miss a change.
 */
export function activityStatement(
	actor: Actor,
	action: string,
	target: { type: string; id: number | null },
	data: unknown,
	at: Date,
): Statement {
	return sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
		VALUES (${at.toISOString()}, ${actor.type}, ${actor.id}, ${actor.name}, ${action}, ${target.type},
			${target.id}, ${data === undefined ? null : JSON.stringify(data)})`;
}

export type ActivityRow = Record<string, string | number | null>;

export async function listActivity(db: Db, query: { limit: number }): Promise<ActivityRow[]> {
	return db.all<ActivityRow>(
		sql`SELECT id, at, actor_type, actor_id, actor_name, action, target_type, target_id, data
			FROM activity ORDER BY id DESC LIMIT ${query.limit}`,
	);
}
