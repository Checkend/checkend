import type { Db } from "../../ports/db.ts";
import { sql } from "../../ports/db.ts";
import { normalizeFilename } from "../ingest/fingerprint.ts";
import type { NormalizedEvent, NormalizedFrame } from "../ingest/normalize.ts";
import { cleanText } from "../ingest/normalize.ts";
import { scrubString } from "../ingest/scrub.ts";
import { applyProjectScrub, compileScrub, type ProjectScrub } from "../scrub-settings.ts";

/**
 * The only data that Checkend sends to a model: the error, scrubbed and normalized again just
 * before the call. Not sent: the user, the request, tags, extra data, contexts, breadcrumbs,
 * the server name and the release. The text comes from the monitored application, so it is
 * untrusted: the models answer only typed questions (decisions) or make vectors, and their
 * output is advice.
 */
export interface ModelState {
	title: string;
	level: string;
	platform: string | null;
	environment: string | null;
	message: string | null;
	exceptions: {
		type: string | null;
		value: string;
		frames: {
			function: string | null;
			location: string | null;
			line: number | null;
			source?: string;
		}[];
	}[];
}

declare const brand: unique symbol;
/** Made only by buildModelInput: model calls take this type, so no call skips the scrub. */
export type ModelInput = { readonly state: ModelState; readonly text: string } & {
	readonly [brand]: true;
};

const MAX_EXCEPTIONS = 3;
const MAX_FRAMES = 8;

// Placeholders, in this order (a UUID is also hex; an email has dots like an address).
const PLACEHOLDERS: [RegExp, string][] = [
	[/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>"],
	[/\b(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1?<query>"],
	[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
	[/\b(?:[0-9a-f]{1,4}:){4,7}[0-9a-f]{1,4}\b/gi, "<ip>"],
	[/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "<ip>"],
	[/\b[0-9a-f]{16,}\b/gi, "<hex>"],
	[/\b\d{5,}\b/g, "<n>"],
];

/** Scrubs one string again (default and project rules), then replaces unique values. */
export function normalizeForModel(value: string, project: ProjectScrub | null): string {
	let out = scrubString(value);
	if (project) out = applyProjectScrub(out, project) as string;
	for (const [pattern, replacement] of PLACEHOLDERS) out = out.replace(pattern, replacement);
	return out;
}

/** In-app frames when there are any; the frame that raised the error first. */
function topFrames(frames: NormalizedFrame[]): NormalizedFrame[] {
	const inApp = frames.filter((f) => f.in_app === true);
	return (inApp.length > 0 ? inApp : frames).slice(-MAX_FRAMES).reverse();
}

export function buildModelInput(
	issue: { title: string; level: string },
	event: NormalizedEvent | null,
	project: ProjectScrub | null,
): ModelInput {
	const norm = (value: string | null | undefined, max: number) =>
		value === null || value === undefined
			? null
			: normalizeForModel(cleanText(value, max), project);
	const exceptions = (event?.exceptions ?? [])
		.slice(-MAX_EXCEPTIONS)
		.reverse()
		.map((exception) => ({
			type: norm(exception.type, 120),
			value: norm(exception.value, 500) ?? "",
			frames: topFrames(exception.frames).map((frame, i) => {
				const file = frame.filename ?? frame.abs_path;
				const source = i === 0 ? norm(frame.context_line?.trim(), 160) : null;
				return {
					function: norm(frame.function, 120),
					location: norm(frame.module ?? (file ? normalizeFilename(file) : null), 160),
					line: frame.lineno,
					...(source ? { source } : {}),
				};
			}),
		}));
	const state: ModelState = {
		title: norm(issue.title, 300) ?? "",
		level: issue.level,
		platform: norm(event?.platform, 40),
		environment: norm(event?.environment, 60),
		message: norm(event?.message, 500),
		exceptions,
	};
	const text = [
		state.title,
		...exceptions.flatMap((e) => [
			`${e.type ? `${e.type}: ` : ""}${e.value}`,
			...e.frames.map(
				(f) =>
					`  at ${f.function ?? "?"} (${f.location ?? "?"}${f.line === null ? "" : `:${f.line}`})`,
			),
		]),
	].join("\n");
	return { state, text } as ModelInput;
}

/** The model input of an issue, with the project's current scrub settings. Null: no issue. */
export async function issueModelInput(db: Db, issueId: number): Promise<ModelInput | null> {
	const issue = await db.first<{
		title: string;
		level: string;
		scrub_keys: string | null;
		scrub_patterns: string | null;
	}>(
		sql`SELECT i.title, i.level, p.scrub_keys, p.scrub_patterns
			FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.id = ${issueId}`,
	);
	if (!issue) return null;
	const latest = await db.first<{ data: string }>(
		sql`SELECT data FROM events WHERE issue_id = ${issueId} ORDER BY id DESC LIMIT 1`,
	);
	const parse = (value: string | null) => (value ? (JSON.parse(value) as string[]) : null);
	return buildModelInput(
		issue,
		latest ? (JSON.parse(latest.data) as NormalizedEvent) : null,
		compileScrub(parse(issue.scrub_keys), parse(issue.scrub_patterns)),
	);
}
