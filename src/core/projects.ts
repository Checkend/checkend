import * as v from "valibot";
import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import { findProjectRowId } from "./issues.ts";
import type { Actor } from "./tokens.ts";

/** A GitHub repository: owner/name. Stored lowercase (GitHub names are case-insensitive). */
export const RepositoryName = v.pipe(
	v.string(),
	v.regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/),
	v.transform((name) => name.toLowerCase()),
);

/** A browser origin: scheme, host and optional port, no path. */
export const Origin = v.pipe(
	v.string(),
	v.regex(/^https?:\/\/[A-Za-z0-9.-]{1,253}(:\d{1,5})?$/),
	v.transform((origin) => origin.toLowerCase()),
);

export const MAX_ALLOWED_ORIGINS = 20;

export const UpdateProjectBody = v.strictObject({
	/** The GitHub repository of the project, or null to remove it. */
	repository: v.optional(v.nullable(RepositoryName)),
	/** low or high; null: automatic (low after the first browser event). */
	trust: v.optional(v.nullable(v.picklist(["low", "high"]))),
	/** Origins that browser events can come from; null: any origin. */
	allowed_origins: v.optional(
		v.nullable(v.pipe(v.array(Origin), v.minLength(1), v.maxLength(MAX_ALLOWED_ORIGINS))),
	),
	/** Events per day (UTC) that ingest accepts; null: no quota. */
	daily_quota: v.optional(
		v.nullable(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1_000_000_000))),
	),
});
export type UpdateProjectBody = v.InferOutput<typeof UpdateProjectBody>;

export interface CreatedProject {
	/** The public ID: in the DSN, the ingest URL and the API. */
	id: number;
	/** The row ID. Internal only: it never leaves Checkend. */
	internalId: number;
	name: string;
	slug: string;
	platform: string | null;
	publicKey: string;
	createdAt: string;
}

export interface ProjectSummary {
	id: number;
	name: string;
	slug: string;
	platform: string | null;
	repository: string | null;
	/** The trust level now: the setting, or automatic (low after a browser event). */
	trust: "low" | "high";
	trust_setting: "low" | "high" | null;
	allowed_origins: string[] | null;
	/** Events per day that ingest accepts (null: no quota), and the events of today (UTC). */
	daily_quota: number | null;
	events_today: number;
	created_at: string;
	keys: string[];
}

export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48);
	return slug || "project";
}

/**
 * A random public project ID with 10 digits (1000000000 to 9999999999), never in order, so
 * that IDs do not show how many projects exist. Numeric, because Sentry SDKs accept only
 * digits as the project ID of a DSN.
 */
export function newPublicProjectId(): number {
	const [high = 0, low = 0] = crypto.getRandomValues(new Uint32Array(2));
	const random = (high % 2 ** 21) * 2 ** 32 + low; // 53 random bits
	return 1_000_000_000 + (random % 9_000_000_000);
}

/** A DSN public key: 16 random bytes as hex. It identifies the project; it is not a secret. */
export function newPublicKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates a project and its first DSN key in one atomic batch. */
export async function createProject(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	input: { name: string; platform?: string | null | undefined },
	actor?: Actor,
): Promise<CreatedProject> {
	const name = input.name.trim();
	if (name.length === 0 || name.length > 100) {
		throw new RangeError("A project name must have 1 to 100 characters.");
	}
	const platform = input.platform?.trim().slice(0, 32) || null;
	const base = slugify(name);
	const taken = new Set(
		(
			await db.all<{ slug: string }>(
				sql`SELECT slug FROM projects WHERE slug = ${base} OR slug LIKE ${`${base}-%`}`,
			)
		).map((row) => row.slug),
	);
	let slug = base;
	for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;

	const createdAt = clock.now().toISOString();
	const publicKey = newPublicKey();
	for (let attempt = 1; ; attempt++) {
		const publicId = newPublicProjectId();
		try {
			const [project] = await db.batch([
				sql`INSERT INTO projects (name, slug, platform, created_at, public_id)
					VALUES (${name}, ${slug}, ${platform}, ${createdAt}, ${publicId}) RETURNING id`,
				sql`INSERT INTO project_keys (project_id, public_key, label, created_at)
					SELECT id, ${publicKey}, ${"default"}, ${createdAt} FROM projects WHERE slug = ${slug}`,
				// The activity target is the public ID: the row ID never leaves Checkend.
				...(actor
					? [
							activityStatement(
								actor,
								"project.create",
								{ type: "project", id: publicId },
								{ name, slug, platform },
								new Date(createdAt),
							),
						]
					: []),
			]);
			const internalId = Number(project?.rows[0]?.id);
			return { id: publicId, internalId, name, slug, platform, publicKey, createdAt };
		} catch (error) {
			// A public ID collision (1 in 9 billion per project): try another one.
			if (attempt >= 5 || !/UNIQUE.*public_id|projects_public_id/i.test(String(error))) throw error;
		}
	}
}

export async function listProjects(db: Db, now: Date = new Date()): Promise<ProjectSummary[]> {
	const today = `${now.toISOString().slice(0, 10)}T00`;
	const projects = await db.all<
		Omit<ProjectSummary, "keys" | "allowed_origins"> & {
			internal_id: number;
			allowed_origins: string | null;
		}
	>(
		sql`SELECT id AS internal_id, public_id AS id, name, slug, platform, repository,
				coalesce(trust, CASE WHEN browser_seen_at IS NULL THEN 'high' ELSE 'low' END) AS trust,
				trust AS trust_setting, allowed_origins, daily_quota,
				(SELECT coalesce(sum(c.count), 0) FROM issue_counts c JOIN issues i ON i.id = c.issue_id
					WHERE i.project_id = projects.id AND c.hour >= ${today}) AS events_today,
				created_at
			FROM projects ORDER BY internal_id`,
	);
	const keys = await db.all<{ project_id: number; public_key: string }>(
		sql`SELECT project_id, public_key FROM project_keys WHERE revoked_at IS NULL ORDER BY id`,
	);
	return projects.map(({ internal_id, allowed_origins, ...p }) => ({
		...p,
		allowed_origins: allowed_origins ? (JSON.parse(allowed_origins) as string[]) : null,
		keys: keys.filter((k) => k.project_id === internal_id).map((k) => k.public_key),
	}));
}

/** Changes project settings. Returns false when there is no such project. */
export async function updateProject(
	ports: Pick<Ports, "db" | "clock">,
	actor: Actor,
	ref: string,
	body: UpdateProjectBody,
): Promise<boolean> {
	const projectId = await findProjectRowId(ports.db, ref);
	if (projectId === null) return false;
	const statements = [];
	if (body.repository !== undefined) {
		statements.push(
			sql`UPDATE projects SET repository = ${body.repository} WHERE id = ${projectId}`,
		);
	}
	if (body.trust !== undefined) {
		statements.push(sql`UPDATE projects SET trust = ${body.trust} WHERE id = ${projectId}`);
	}
	if (body.allowed_origins !== undefined) {
		const origins = body.allowed_origins
			? JSON.stringify([...new Set(body.allowed_origins)])
			: null;
		statements.push(sql`UPDATE projects SET allowed_origins = ${origins} WHERE id = ${projectId}`);
	}
	if (body.daily_quota !== undefined) {
		statements.push(
			sql`UPDATE projects SET daily_quota = ${body.daily_quota} WHERE id = ${projectId}`,
		);
	}
	if (statements.length === 0) return true;
	await ports.db.batch([
		...statements,
		activityStatement(
			actor,
			"project.update",
			{ type: "project", id: projectId },
			body,
			ports.clock.now(),
		),
	]);
	return true;
}

/** The GitHub repository of a project, or null. */
export async function projectRepository(db: Db, projectId: number): Promise<string | null> {
	const row = await db.first<{ repository: string | null }>(
		sql`SELECT repository FROM projects WHERE id = ${projectId}`,
	);
	return row?.repository ?? null;
}

/** A known DSN key: the internal project row ID and the allowed browser origins. */
export interface KeyLookup {
	projectId: number;
	/** Origins that browser events can come from; null: any origin. */
	allowedOrigins: string[] | null;
	/** Events per day that ingest accepts; null: no quota. */
	dailyQuota: number | null;
}

interface CacheEntry {
	/** projectId is the internal row ID, for the write. */
	value: KeyLookup | null;
	expires: number;
}

/**
 * DSN key lookups, cached in memory per isolate for 60 seconds, so that each ingest request
 * does not read D1. A revoked key keeps working until its cache entry expires. Known and
 * unknown keys are in separate maps, so that requests with random keys cannot push valid
 * keys out; when a map is full, its oldest entry goes.
 */
export class KeyCache {
	private known = new Map<string, CacheEntry>();
	private unknown = new Map<string, CacheEntry>();

	private readonly maxEntries: number;
	private readonly ttlMs: number;

	// Plain fields, not parameter properties: Node type stripping does not support those.
	constructor(maxEntries = 1000, ttlMs = 60_000) {
		this.maxEntries = maxEntries;
		this.ttlMs = ttlMs;
	}

	get size(): number {
		return this.known.size + this.unknown.size;
	}

	/** The cached result, or undefined when a D1 lookup is necessary. */
	peek(projectId: number, publicKey: string, now: Date): KeyLookup | null | undefined {
		const cacheKey = `${projectId}:${publicKey}`;
		const cached = this.known.get(cacheKey) ?? this.unknown.get(cacheKey);
		return cached && cached.expires > now.getTime() ? cached.value : undefined;
	}

	async find(db: Db, projectId: number, publicKey: string, now: Date): Promise<KeyLookup | null> {
		const cached = this.peek(projectId, publicKey, now);
		if (cached !== undefined) return cached;

		// projectId here is the public ID from the URL; the result has the internal row ID.
		const row = await db.first<{
			project_id: number;
			allowed_origins: string | null;
			daily_quota: number | null;
		}>(
			sql`SELECT k.project_id, p.allowed_origins, p.daily_quota FROM project_keys k JOIN projects p ON p.id = k.project_id
				WHERE k.public_key = ${publicKey} AND p.public_id = ${projectId} AND k.revoked_at IS NULL`,
		);
		const value = row
			? {
					projectId: row.project_id,
					allowedOrigins: row.allowed_origins
						? (JSON.parse(row.allowed_origins) as string[])
						: null,
					dailyQuota: row.daily_quota,
				}
			: null;
		const cacheKey = `${projectId}:${publicKey}`;
		const map = value ? this.known : this.unknown;
		this.known.delete(cacheKey);
		this.unknown.delete(cacheKey);
		if (map.size >= this.maxEntries) {
			const oldest = map.keys().next().value;
			if (oldest !== undefined) map.delete(oldest);
		}
		map.set(cacheKey, { value, expires: now.getTime() + this.ttlMs });
		return value;
	}
}
