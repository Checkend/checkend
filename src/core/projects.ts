import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

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
			]);
			const internalId = Number(project?.rows[0]?.id);
			return { id: publicId, internalId, name, slug, platform, publicKey, createdAt };
		} catch (error) {
			// A public ID collision (1 in 9 billion per project): try another one.
			if (attempt >= 5 || !/UNIQUE.*public_id|projects_public_id/i.test(String(error))) throw error;
		}
	}
}

export async function listProjects(db: Db): Promise<ProjectSummary[]> {
	const projects = await db.all<Omit<ProjectSummary, "keys"> & { internal_id: number }>(
		sql`SELECT id AS internal_id, public_id AS id, name, slug, platform, created_at FROM projects ORDER BY internal_id`,
	);
	const keys = await db.all<{ project_id: number; public_key: string }>(
		sql`SELECT project_id, public_key FROM project_keys WHERE revoked_at IS NULL ORDER BY id`,
	);
	return projects.map(({ internal_id, ...p }) => ({
		...p,
		keys: keys.filter((k) => k.project_id === internal_id).map((k) => k.public_key),
	}));
}

interface CacheEntry {
	/** projectId is the internal row ID, for the write. */
	value: { projectId: number } | null;
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

	constructor(
		private readonly maxEntries = 1000,
		private readonly ttlMs = 60_000,
	) {}

	get size(): number {
		return this.known.size + this.unknown.size;
	}

	/** The cached result, or undefined when a D1 lookup is necessary. */
	peek(projectId: number, publicKey: string, now: Date): { projectId: number } | null | undefined {
		const cacheKey = `${projectId}:${publicKey}`;
		const cached = this.known.get(cacheKey) ?? this.unknown.get(cacheKey);
		return cached && cached.expires > now.getTime() ? cached.value : undefined;
	}

	async find(
		db: Db,
		projectId: number,
		publicKey: string,
		now: Date,
	): Promise<{ projectId: number } | null> {
		const cached = this.peek(projectId, publicKey, now);
		if (cached !== undefined) return cached;

		// projectId here is the public ID from the URL; the result has the internal row ID.
		const row = await db.first<{ project_id: number }>(
			sql`SELECT k.project_id FROM project_keys k JOIN projects p ON p.id = k.project_id
				WHERE k.public_key = ${publicKey} AND p.public_id = ${projectId} AND k.revoked_at IS NULL`,
		);
		const value = row ? { projectId: row.project_id } : null;
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
