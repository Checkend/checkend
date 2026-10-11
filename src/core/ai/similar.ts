import * as v from "valibot";
import { type Db, sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import type { ModelRunner } from "../../ports/model-runner.ts";
import { issueModelInput, normalizeForModel } from "./model-input.ts";

/**
 * Similar issues (AI_SIMILAR): the cron embeds new issues (the scrubbed model input text) and
 * keeps their vectors in the vector index; a later run finds the neighbours of each issue, ranks
 * them with a reranker, and stores the close ones (issue_similar). The brief reads them; no model
 * call in the brief. search_similar searches live, by issue or by text.
 */
export const EMBEDDING_MODEL = "@cf/qwen/qwen3-embedding-0.6b";
export const RERANKER_MODEL = "@cf/baai/bge-reranker-base";
/** The vectors of the embedding model (the Vectorize index must have the same). */
export const EMBEDDING_DIMENSIONS = 1024;
/** The model reads at most 4,096 tokens; at 1 token per character this stays inside. */
const MAX_TEXT_CHARS = 3000;
const EMBED_PER_RUN = 50;
const NEIGHBORS_PER_RUN = 20;
/** Vectorize makes an upsert visible after a few seconds. */
const INDEX_SETTLE_MS = 60_000;
const CANDIDATES = 20;
/** Cosine similarity from which an issue counts as similar (stored, shown in the brief). */
export const MIN_SIMILARITY = 0.75;
/** A live search shows weaker matches too, with their scores. */
const SEARCH_MIN = 0.3;
const KEEP_NEIGHBORS = 5;

type SimilarPorts = Pick<Ports, "db" | "clock" | "config" | "models" | "vectors">;

const on = (ports: SimilarPorts) => ports.config.ai.similar && ports.models && ports.vectors;

/** Embeds texts in one call. Checks the output: one vector of 1024 numbers per text. */
export async function embedTexts(models: ModelRunner, texts: string[]): Promise<number[][]> {
	const output = (await models.run(EMBEDDING_MODEL, {
		text: texts.map((t) => t.slice(0, MAX_TEXT_CHARS)),
	})) as { data?: unknown } | null;
	const data = output?.data;
	if (
		!Array.isArray(data) ||
		data.length !== texts.length ||
		!data.every(
			(v) =>
				Array.isArray(v) &&
				v.length === EMBEDDING_DIMENSIONS &&
				v.every((x) => typeof x === "number" && Number.isFinite(x)),
		)
	) {
		throw new Error(`The embedding model did not return ${EMBEDDING_DIMENSIONS}-number vectors.`);
	}
	return data as number[][];
}

/** The cron: embeds issues that have no embedding yet. Returns the number embedded. */
export async function runEmbeddings(ports: SimilarPorts, now: Date): Promise<number> {
	if (!on(ports) || !ports.models || !ports.vectors) return 0;
	const due = await ports.db.all<{ id: number }>(
		sql`SELECT i.id FROM issues i JOIN projects p ON p.id = i.project_id AND p.deleted_at IS NULL
			LEFT JOIN issue_embeddings e ON e.issue_id = i.id
			WHERE e.issue_id IS NULL AND i.status != 'merged'
			ORDER BY i.id LIMIT ${EMBED_PER_RUN}`,
	);
	const items: { id: number; text: string }[] = [];
	for (const { id } of due) {
		const input = await issueModelInput(ports.db, id);
		if (input) items.push({ id, text: input.text.slice(0, MAX_TEXT_CHARS) });
	}
	if (items.length === 0) return 0;
	const vectors = await embedTexts(
		ports.models,
		items.map((i) => i.text),
	);
	await ports.vectors.upsert(
		items.map((item, i) => ({ id: String(item.id), values: vectors[i] ?? [] })),
	);
	await ports.db.batch(
		items.map(
			(item) =>
				sql`INSERT INTO issue_embeddings (issue_id, model, text, embedded_at)
					VALUES (${item.id}, ${EMBEDDING_MODEL}, ${item.text}, ${now.toISOString()})
					ON CONFLICT (issue_id) DO NOTHING`,
		),
	);
	return items.length;
}

interface Candidate {
	id: number;
	score: number;
	text: string;
}

/** Live candidates for the matches: open issues of live projects, with their texts. */
async function candidates(
	db: Db,
	matches: { id: string; score: number }[],
	exclude: number | null,
) {
	const ids = matches
		.map((m) => Number(m.id))
		.filter((id) => Number.isInteger(id) && id !== exclude);
	if (ids.length === 0) return [];
	const rows = await db.all<{ id: number; text: string }>(
		sql`SELECT e.issue_id AS id, e.text FROM issue_embeddings e
			JOIN issues i ON i.id = e.issue_id JOIN projects p ON p.id = i.project_id
			WHERE e.issue_id IN (SELECT value FROM json_each(${JSON.stringify(ids)}))
				AND i.status != 'merged' AND p.deleted_at IS NULL`,
	);
	const score = new Map(matches.map((m) => [Number(m.id), m.score]));
	return rows.map((r) => ({ id: r.id, text: r.text, score: score.get(r.id) ?? 0 }));
}

/** Orders candidates with the reranker (best first). On a reranker failure: by vector score. */
async function rerank(models: ModelRunner, query: string, list: Candidate[]): Promise<Candidate[]> {
	if (list.length < 2) return list;
	try {
		const output = (await models.run(RERANKER_MODEL, {
			query: query.slice(0, MAX_TEXT_CHARS),
			contexts: list.map((c) => ({ text: c.text.slice(0, MAX_TEXT_CHARS) })),
		})) as { response?: { id?: unknown; score?: unknown }[] } | null;
		const rank = new Map<number, number>();
		for (const r of output?.response ?? []) {
			if (typeof r.id === "number" && typeof r.score === "number") rank.set(r.id, r.score);
		}
		return list
			.map((c, i) => ({ c, r: rank.get(i) ?? Number.NEGATIVE_INFINITY }))
			.sort((a, b) => b.r - a.r || b.c.score - a.c.score)
			.map(({ c }) => c);
	} catch {
		return [...list].sort((a, b) => b.score - a.score);
	}
}

/** The cron: neighbours of embedded issues (after the index settled). Returns issues done. */
export async function runNeighbors(ports: SimilarPorts, now: Date): Promise<number> {
	if (!on(ports) || !ports.models || !ports.vectors) return 0;
	const settled = new Date(now.getTime() - INDEX_SETTLE_MS).toISOString();
	const due = await ports.db.all<{ id: number; text: string }>(
		sql`SELECT issue_id AS id, text FROM issue_embeddings
			WHERE neighbors_at IS NULL AND embedded_at <= ${settled}
			ORDER BY issue_id LIMIT ${NEIGHBORS_PER_RUN}`,
	);
	const at = now.toISOString();
	for (const issue of due) {
		const matches = await ports.vectors.queryById(String(issue.id), CANDIDATES + 1);
		const close = (await candidates(ports.db, matches, issue.id)).filter(
			(c) => c.score >= MIN_SIMILARITY,
		);
		const ranked = (await rerank(ports.models, issue.text, close)).slice(0, KEEP_NEIGHBORS);
		await ports.db.batch([
			// Both directions: an older issue also gets its new neighbour.
			...ranked.flatMap((c) => [
				sql`INSERT INTO issue_similar (issue_id, similar_id, score, computed_at)
					VALUES (${issue.id}, ${c.id}, ${c.score}, ${at})
					ON CONFLICT (issue_id, similar_id) DO UPDATE SET score = excluded.score, computed_at = excluded.computed_at`,
				sql`INSERT INTO issue_similar (issue_id, similar_id, score, computed_at)
					VALUES (${c.id}, ${issue.id}, ${c.score}, ${at})
					ON CONFLICT (issue_id, similar_id) DO NOTHING`,
			]),
			sql`UPDATE issue_embeddings SET neighbors_at = ${at} WHERE issue_id = ${issue.id}`,
		]);
	}
	return due.length;
}

export type SimilarIssue = {
	id: number;
	/** The public project ID. */
	project_id: number;
	status: string;
	/** Cosine similarity (0 to 1). */
	score: number;
	/** From the events: untrusted text. */
	title: string;
};

/** The stored similar issues of an issue, the most similar first. */
export async function similarIssues(
	db: Db,
	issueId: number,
	limit = KEEP_NEIGHBORS,
): Promise<SimilarIssue[]> {
	return db.all<SimilarIssue>(
		sql`SELECT i.id, p.public_id AS project_id, i.status, round(s.score, 2) AS score, i.title
			FROM issue_similar s JOIN issues i ON i.id = s.similar_id JOIN projects p ON p.id = i.project_id
			WHERE s.issue_id = ${issueId} AND i.status != 'merged' AND p.deleted_at IS NULL
			ORDER BY s.score DESC, i.id LIMIT ${limit}`,
	);
}

/** A live search: by an issue (its stored vector) or by a text (embedded now). */
export async function searchSimilar(
	ports: SimilarPorts,
	query: { issueId: number } | { text: string },
	limit: number,
): Promise<SimilarIssue[] | null> {
	if (!on(ports) || !ports.models || !ports.vectors) return null;
	let matches: { id: string; score: number }[];
	let queryText: string;
	let exclude: number | null = null;
	if ("issueId" in query) {
		const row = await ports.db.first<{ text: string }>(
			sql`SELECT text FROM issue_embeddings WHERE issue_id = ${query.issueId}`,
		);
		if (!row) return [];
		queryText = row.text;
		exclude = query.issueId;
		matches = await ports.vectors.queryById(String(query.issueId), CANDIDATES + 1);
	} else {
		// A text from an agent can hold pasted secrets or personal data, like event text.
		queryText = normalizeForModel(query.text.slice(0, MAX_TEXT_CHARS), null);
		const [vector] = await embedTexts(ports.models, [queryText]);
		matches = await ports.vectors.query(vector ?? [], CANDIDATES);
	}
	const list = (await candidates(ports.db, matches, exclude)).filter((c) => c.score >= SEARCH_MIN);
	const ranked = (await rerank(ports.models, queryText, list)).slice(0, limit);
	if (ranked.length === 0) return [];
	const rows = await ports.db.all<Omit<SimilarIssue, "score">>(
		sql`SELECT i.id, p.public_id AS project_id, i.status, i.title FROM issues i
			JOIN projects p ON p.id = i.project_id
			WHERE i.id IN (SELECT value FROM json_each(${JSON.stringify(ranked.map((c) => c.id))}))`,
	);
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ranked.flatMap((c) => {
		const row = byId.get(c.id);
		return row ? [{ ...row, score: Math.round(c.score * 100) / 100 }] : [];
	});
}

/** The input of search_similar: an issue, or a text (for example an error message). */
export const SimilarSearchBody = v.pipe(
	v.strictObject({
		issue_id: v.optional(
			v.union([
				v.pipe(v.number(), v.integer(), v.minValue(1)),
				v.pipe(v.string(), v.regex(/^\d{1,15}$/), v.transform(Number)),
			]),
		),
		text: v.optional(v.pipe(v.string(), v.regex(/\S/, "The text is empty."), v.maxLength(2000))),
		limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20))),
	}),
	v.check(
		(body) => (body.issue_id === undefined) !== (body.text === undefined),
		"Give issue_id or text (one of them).",
	),
);
export type SimilarSearch = v.InferOutput<typeof SimilarSearchBody>;

/** Runs a search from the API or MCP input. Null: similar issues are off. */
export function searchFromInput(ports: SimilarPorts, input: SimilarSearch) {
	return searchSimilar(
		ports,
		input.issue_id === undefined
			? { text: (input.text ?? "").trim() }
			: { issueId: input.issue_id },
		input.limit ?? 5,
	);
}

export const SIMILAR_OFF =
	"Similar issues are off. They need AI_SIMILAR=on, Workers AI (the AI binding, or a Cloudflare account and token on Node) and a vector index (the VECTORIZE binding on Cloudflare).";
