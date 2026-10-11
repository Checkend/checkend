import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

/** The setup steps of one app, for the live checklist (UI) and `ce` (GET /v1/setup/progress). */
export interface AppProgress {
	project: { id: number; slug: string; name: string; platform: string | null; demo: boolean };
	/** The app was registered (or created). */
	connected_at: string;
	/** The agent reported the SDK install. */
	sdk_installed_at: string | null;
	/** The test event of `ce setup`. */
	test_event_at: string | null;
	/** The first event that is not the test event. */
	first_event_at: string | null;
	/** The first MCP call of an agent token of this app; name: the MCP client name. */
	agent: { name: string | null; at: string } | null;
	first_deploy_at: string | null;
}

export interface OnboardingProgress {
	apps: AppProgress[];
	/** Setup keys that are not expired or revoked: an agent may still connect an app. */
	setup_keys_active: number;
}

/**
 * The progress of every app that is not deleted, or of the apps of one setup key. A few indexed
 * reads, so that the UI can poll it every 2 seconds.
 */
export async function onboardingProgress(
	db: Db,
	now: Date,
	options: { setupKeyId?: number } = {},
): Promise<OnboardingProgress> {
	const keyId = options.setupKeyId ?? null;
	const rows = await db.all<{
		id: number;
		slug: string;
		name: string;
		platform: string | null;
		demo: number;
		connected_at: string;
		sdk_installed_at: string | null;
		test_event_at: string | null;
		first_event_at: string | null;
		agent_name: string | null;
		agent_at: string | null;
		first_deploy_at: string | null;
	}>(
		sql`SELECT p.public_id AS id, p.slug, p.name, p.platform, p.demo,
				coalesce(s.connected_at, p.created_at) AS connected_at,
				s.sdk_installed_at, s.test_event_at,
				(SELECT i.first_seen FROM issues i WHERE i.project_id = p.id AND i.test = 0
					ORDER BY i.first_seen LIMIT 1) AS first_event_at,
				(SELECT t.mcp_client FROM tokens t WHERE t.project_id = p.id AND t.first_mcp_at IS NOT NULL
					ORDER BY t.first_mcp_at LIMIT 1) AS agent_name,
				(SELECT min(t.first_mcp_at) FROM tokens t WHERE t.project_id = p.id) AS agent_at,
				(SELECT min(d.deployed_at) FROM deploys d WHERE d.project_id = p.id) AS first_deploy_at
			FROM projects p LEFT JOIN project_setup s ON s.project_id = p.id
			WHERE p.deleted_at IS NULL AND (${keyId} IS NULL OR s.setup_key_id = ${keyId})
			ORDER BY p.id`,
	);
	const active = await db.first<{ n: number }>(
		sql`SELECT count(*) AS n FROM setup_keys WHERE revoked_at IS NULL AND expires_at > ${now.toISOString()}`,
	);
	return {
		setup_keys_active: active?.n ?? 0,
		apps: rows.map((row) => ({
			project: {
				id: row.id,
				slug: row.slug,
				name: row.name,
				platform: row.platform,
				demo: row.demo === 1,
			},
			connected_at: row.connected_at,
			sdk_installed_at: row.sdk_installed_at,
			test_event_at: row.test_event_at,
			first_event_at: row.first_event_at,
			agent: row.agent_at ? { name: row.agent_name, at: row.agent_at } : null,
			first_deploy_at: row.first_deploy_at,
		})),
	};
}

/**
 * The first MCP call of a token, and the MCP client name (from initialize). Writes only until
 * both are known, so later calls cost one read-free UPDATE that changes no row.
 */
export async function recordMcpCall(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	tokenId: number,
	clientName: string | null,
): Promise<void> {
	const name = clientName ? clientName.replace(/[^\x20-\x7e]/g, "").slice(0, 64) || null : null;
	await db.run(
		sql`UPDATE tokens SET first_mcp_at = coalesce(first_mcp_at, ${clock.now().toISOString()}),
				mcp_client = coalesce(mcp_client, ${name})
			WHERE id = ${tokenId} AND (first_mcp_at IS NULL OR (mcp_client IS NULL AND ${name} IS NOT NULL))`,
	);
}
