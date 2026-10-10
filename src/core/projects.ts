import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";

export interface CreatedProject {
	id: number;
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
	const [project] = await db.batch([
		sql`INSERT INTO projects (name, slug, platform, created_at)
			VALUES (${name}, ${slug}, ${platform}, ${createdAt}) RETURNING id`,
		sql`INSERT INTO project_keys (project_id, public_key, label, created_at)
			SELECT id, ${publicKey}, ${"default"}, ${createdAt} FROM projects WHERE slug = ${slug}`,
	]);
	const id = Number(project?.rows[0]?.id);
	return { id, name, slug, platform, publicKey, createdAt };
}

export async function listProjects(db: Db): Promise<ProjectSummary[]> {
	const projects = await db.all<Omit<ProjectSummary, "keys">>(
		sql`SELECT id, name, slug, platform, created_at FROM projects ORDER BY id`,
	);
	const keys = await db.all<{ project_id: number; public_key: string }>(
		sql`SELECT project_id, public_key FROM project_keys WHERE revoked_at IS NULL ORDER BY id`,
	);
	return projects.map((p) => ({
		...p,
		keys: keys.filter((k) => k.project_id === p.id).map((k) => k.public_key),
	}));
}

interface CacheEntry {
	value: { projectId: number } | null;
	expires: number;
}

/**
 * DSN key lookups, cached in memory per isolate for 60 seconds, so that each ingest request
 * does not read D1. A revoked key keeps working until its cache entry expires.
 */
export class KeyCache {
	private entries = new Map<string, CacheEntry>();

	constructor(
		private readonly maxEntries = 1000,
		private readonly ttlMs = 60_000,
	) {}

	get size(): number {
		return this.entries.size;
	}

	async find(
		db: Db,
		projectId: number,
		publicKey: string,
		now: Date,
	): Promise<{ projectId: number } | null> {
		const cacheKey = `${projectId}:${publicKey}`;
		const cached = this.entries.get(cacheKey);
		if (cached && cached.expires > now.getTime()) return cached.value;

		const row = await db.first<{ project_id: number }>(
			sql`SELECT project_id FROM project_keys
				WHERE public_key = ${publicKey} AND project_id = ${projectId} AND revoked_at IS NULL`,
		);
		const value = row ? { projectId: row.project_id } : null;
		if (this.entries.size >= this.maxEntries) this.entries.clear();
		this.entries.set(cacheKey, { value, expires: now.getTime() + this.ttlMs });
		return value;
	}
}
