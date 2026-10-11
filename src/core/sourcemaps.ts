import * as v from "valibot";
import type { BlobStore } from "../ports/blob-store.ts";
import { type Db, sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { activityStatement } from "./activity.ts";
import type { NormalizedEvent, NormalizedFrame } from "./ingest/normalize.ts";
import { findProjectRowId, ProjectRef } from "./issues.ts";
import {
	buildSourceMapIndex,
	InvalidSourceMap,
	lookupPosition,
	openSourceMapIndex,
	type SourceMapIndex,
	sourceLines,
} from "./sourcemap-index.ts";
import type { Actor } from "./tokens.ts";

/**
 * Source maps for readable JavaScript frames. CI uploads the map of each minified file of a
 * release; Checkend builds the line index once (or takes a prebuilt one) and stores it in the
 * blob store. The brief then maps each frame of an event of that release to its original file,
 * line and source lines.
 */

/** The largest upload (a source map, or a prebuilt index). */
export const MAX_SOURCEMAP_BYTES = 30 * 1024 * 1024;
export const INDEX_CONTENT_TYPE = "application/x-checkend-sourcemap-index";
/** Source lines before and after the line of a mapped frame. */
const CONTEXT_LINES = 5;

const Text = v.pipe(v.string(), v.minLength(1), v.maxLength(500));

export const SourceMapUploadQuery = v.object({
	project: ProjectRef,
	release: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
	/** The minified file: its URL, "~/path" (any host), or a path. */
	name: Text,
});
export const SourceMapListQuery = v.object({
	project: ProjectRef,
	release: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(200))),
});

/** The path of a minified file: the URL path, without the host and the query. */
export function filePath(name: string): string {
	if (name.startsWith("~/")) return name.slice(1).split(/[?#]/)[0] ?? "/";
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(name)) {
		try {
			return new URL(name).pathname || "/";
		} catch {
			// not a URL: use it as a path
		}
	}
	const path = name.split(/[?#]/)[0] ?? "";
	return path.startsWith("/") ? path : `/${path}`;
}

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type UploadResult =
	| { kind: "done"; sourcemap: Record<string, unknown> }
	| { kind: "project_not_found" }
	| { kind: "storage_not_configured" }
	| { kind: "invalid"; message: string };

/** Stores a source map (JSON) or a prebuilt index, for one file of a release. */
export async function uploadSourceMap(
	ports: Pick<Ports, "db" | "clock" | "blobs">,
	actor: Actor,
	query: v.InferOutput<typeof SourceMapUploadQuery>,
	body: Uint8Array,
	prebuilt: boolean,
): Promise<UploadResult> {
	if (!ports.blobs) return { kind: "storage_not_configured" };
	const projectId = await findProjectRowId(ports.db, query.project);
	if (projectId === null) return { kind: "project_not_found" };
	let index: Uint8Array;
	let sources: number;
	try {
		index = prebuilt ? body : buildSourceMapIndex(JSON.parse(new TextDecoder().decode(body)));
		sources = openSourceMapIndex(index).sources;
	} catch (error) {
		if (error instanceof InvalidSourceMap) return { kind: "invalid", message: error.message };
		if (error instanceof SyntaxError) return { kind: "invalid", message: "The body is not JSON." };
		throw error;
	}
	const path = filePath(query.name);
	const blobKey = `sourcemaps/${projectId}/${await sha256Hex(query.release)}/${await sha256Hex(path)}`;
	await ports.blobs.put(blobKey, index);
	const now = ports.clock.now();
	const [row] = await ports.db.batch([
		sql`INSERT INTO sourcemaps (project_id, release, name, path, blob_key, size, sources, uploaded_at, uploaded_by)
			VALUES (${projectId}, ${query.release}, ${query.name}, ${path}, ${blobKey}, ${index.byteLength},
				${sources}, ${now.toISOString()}, ${actor.name})
			ON CONFLICT (project_id, release, path) DO UPDATE SET name = excluded.name,
				blob_key = excluded.blob_key, size = excluded.size, sources = excluded.sources,
				uploaded_at = excluded.uploaded_at, uploaded_by = excluded.uploaded_by
			RETURNING id`,
		activityStatement(
			actor,
			"sourcemap.upload",
			{ type: "project", id: projectId },
			{ release: query.release, name: query.name, size: index.byteLength },
			now,
		),
	]);
	const id = Number(row?.rows[0]?.id);
	const [sourcemap] = (await listSourceMaps(ports.db, projectId, query.release)).filter(
		(m) => m.id === id,
	);
	return { kind: "done", sourcemap: sourcemap ?? { id } };
}

const SOURCEMAP_COLUMNS = `m.id, p.public_id AS project_id, m.release, m.name, m.path, m.size, m.sources,
	m.uploaded_at, m.uploaded_by`;
const LIST_SQL = `SELECT ${SOURCEMAP_COLUMNS} FROM sourcemaps m JOIN projects p ON p.id = m.project_id
	WHERE m.project_id = ? AND (? IS NULL OR m.release = ?) ORDER BY m.id DESC LIMIT 500`;

export async function listSourceMaps(db: Db, projectId: number, release: string | null) {
	return db.all<{ id: number } & Record<string, string | number>>({
		sql: LIST_SQL,
		params: [projectId, release, release],
	});
}

/** Lists the maps of a project (public ID or slug); null when there is no such project. */
export async function listProjectSourceMaps(db: Db, project: string, release: string | null) {
	const projectId = await findProjectRowId(db, project);
	return projectId === null ? null : listSourceMaps(db, projectId, release);
}

export async function deleteSourceMap(
	ports: Pick<Ports, "db" | "clock" | "blobs">,
	actor: Actor,
	id: number,
): Promise<boolean> {
	const row = await ports.db.first<{
		project_id: number;
		blob_key: string;
		release: string;
		name: string;
	}>(sql`SELECT project_id, blob_key, release, name FROM sourcemaps WHERE id = ${id}`);
	if (!row) return false;
	await ports.db.batch([
		sql`DELETE FROM sourcemaps WHERE id = ${id}`,
		activityStatement(
			actor,
			"sourcemap.delete",
			{ type: "project", id: row.project_id },
			{ release: row.release, name: row.name },
			ports.clock.now(),
		),
	]);
	await ports.blobs?.delete(row.blob_key);
	return true;
}

/**
 * Index objects per isolate, the most recently used last; at most MAX_CACHE_BYTES. The key has
 * the scope of the blob store: installs that share an isolate (Durable Objects) have the same
 * blob keys (row IDs start at 1 in each database), but never share an index.
 */
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, SourceMapIndex>();
let cachedBytes = 0;

async function loadIndex(blobs: BlobStore, key: string, version: string) {
	const cacheKey = `${blobs.scope ?? ""}|${key}@${version}`;
	const hit = cache.get(cacheKey);
	if (hit) {
		cache.delete(cacheKey);
		cache.set(cacheKey, hit);
		return hit;
	}
	const bytes = await blobs.get(key);
	if (!bytes) return null;
	let index: SourceMapIndex;
	try {
		index = openSourceMapIndex(bytes);
	} catch {
		return null;
	}
	cache.set(cacheKey, index);
	cachedBytes += bytes.byteLength;
	for (const [oldKey, old] of cache) {
		if (cachedBytes <= MAX_CACHE_BYTES || oldKey === cacheKey) break;
		cache.delete(oldKey);
		cachedBytes -= old.bytes.byteLength;
	}
	return index;
}

/** "webpack://app/./src/x.ts" → "src/x.ts". */
const cleanSource = (source: string) =>
	source.replace(/^webpack:\/\/[^/]*\//, "").replace(/^\.\//, "");

export interface Symbolicated {
	event: NormalizedEvent;
	/** Frames with a line and a column (they can be mapped), and how many were mapped. */
	frames: number;
	mapped: number;
}

/**
 * Maps the frames of an event to the original sources, with the maps of its release. Frames
 * without a map stay as they are. Never throws for a broken or missing map.
 */
export async function symbolicateEvent(
	db: Db,
	blobs: BlobStore | null,
	issueId: number,
	event: NormalizedEvent,
): Promise<Symbolicated> {
	const candidates = event.exceptions
		.flatMap((e) => e.frames)
		.filter((f) => f.lineno !== null && f.colno !== null && (f.abs_path ?? f.filename));
	const unchanged = { event, frames: candidates.length, mapped: 0 };
	if (!blobs || !event.release || candidates.length === 0) return unchanged;
	const maps = await db.all<{ path: string; blob_key: string; uploaded_at: string }>(
		sql`SELECT m.path, m.blob_key, m.uploaded_at FROM sourcemaps m
			JOIN issues i ON i.project_id = m.project_id
			WHERE i.id = ${issueId} AND m.release = ${event.release}`,
	);
	if (maps.length === 0) return unchanged;
	const byPath = new Map(maps.map((m) => [m.path, m]));
	const byName = new Map<string, (typeof maps)[number] | null>();
	for (const m of maps) {
		const name = basename(m.path);
		byName.set(name, byName.has(name) ? null : m); // null: the name is not unique
	}
	let mapped = 0;
	const mapFrame = async (frame: NormalizedFrame): Promise<NormalizedFrame> => {
		const file = frame.abs_path ?? frame.filename;
		if (!file || frame.lineno === null || frame.colno === null) return frame;
		const path = filePath(file);
		const map = byPath.get(path) ?? byName.get(basename(path));
		if (!map) return frame;
		const index = await loadIndex(blobs, map.blob_key, map.uploaded_at).catch(() => null);
		const position = index && lookupPosition(index, frame.lineno, frame.colno);
		if (!index || !position) return frame;
		mapped++;
		const source = cleanSource(position.source);
		const lines = sourceLines(index, position.sourceIndex, position.line, CONTEXT_LINES);
		return {
			...frame,
			filename: source,
			abs_path: source,
			lineno: position.line,
			colno: position.column,
			in_app: /(^|\/)node_modules\//.test(source) ? false : frame.in_app,
			context_line: lines?.line ?? null,
			pre_context: lines?.pre ?? [],
			post_context: lines?.post ?? [],
			mapped_from: `${file}:${frame.lineno}:${frame.colno}`,
		};
	};
	const exceptions = await Promise.all(
		event.exceptions.map(async (exception) => ({
			...exception,
			frames: await Promise.all(exception.frames.map(mapFrame)),
		})),
	);
	return { event: { ...event, exceptions }, frames: candidates.length, mapped };
}
