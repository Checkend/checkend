import { type Db, sql } from "../ports/db.ts";
import type { NormalizedFrame } from "./ingest/normalize.ts";
import { filePath } from "./sourcemaps.ts";

/**
 * The suspect commit of an issue: a commit of the release where the issue was first seen that
 * changed a file of one of its in-app frames. The top frame (where the error was raised) counts
 * most. Commit data comes from GitHub (push deliveries, or the API with GITHUB_TOKEN).
 */
export interface SuspectCommit {
	sha: string;
	/** The GitHub login, or the git author name. */
	author: string | null;
	committed_at: string | null;
	/** The changed files that are in the stack trace. */
	files: string[];
	/** The function of the frame whose file the commit changed. */
	frame: string | null;
	/** The commit on GitHub, when the project has a repository. */
	url: string | null;
}

/** The commit message is text from the repository: the brief shows it as untrusted. */
export interface Suspect {
	commit: SuspectCommit;
	message: string;
}

const MAX_COMMITS = 500;

const segments = (path: string) => filePath(path).split("/").filter(Boolean);

/** True when the repository file `file` is the file of the frame path (a path suffix). */
function sameFile(framePath: string, file: string): boolean {
	const frame = segments(framePath);
	const changed = segments(file);
	if (changed.length === 0 || changed.length > frame.length) return false;
	return changed.every((part, i) => frame[frame.length - changed.length + i] === part);
}

export async function suspectCommit(
	db: Db,
	issueId: number,
	frames: NormalizedFrame[],
): Promise<Suspect | null> {
	// In-app frames, the frame that raised the error first.
	const inApp = frames.filter((f) => f.in_app === true && (f.abs_path ?? f.filename)).reverse();
	if (inApp.length === 0) return null;
	const issue = await db.first<{
		project_id: number;
		first_release: string | null;
		repository: string | null;
	}>(
		sql`SELECT i.project_id, i.first_release, p.repository FROM issues i JOIN projects p ON p.id = i.project_id
			WHERE i.id = ${issueId}`,
	);
	if (!issue?.first_release) return null;
	const commits = await db.all<{
		sha: string;
		message: string;
		author: string | null;
		committed_at: string | null;
		files: string;
	}>(
		sql`SELECT DISTINCT c.sha, c.message, c.author, c.committed_at, c.files
			FROM releases r
			JOIN deploys d ON d.release_id = r.id
			JOIN deploy_refs x ON x.deploy_id = d.id AND x.kind = 'commit'
			JOIN commits c ON c.project_id = r.project_id AND c.sha = x.ref
			WHERE r.project_id = ${issue.project_id} AND r.version = ${issue.first_release}
				AND c.files IS NOT NULL
			LIMIT ${MAX_COMMITS}`,
	);
	let best: { score: number; suspect: Suspect } | null = null;
	for (const commit of commits) {
		let files: string[];
		try {
			files = (JSON.parse(commit.files) as unknown[]).filter(
				(f): f is string => typeof f === "string",
			);
		} catch {
			continue;
		}
		let score = 0;
		let frame: NormalizedFrame | null = null;
		const matched = new Set<string>();
		inApp.forEach((f, k) => {
			const path = f.abs_path ?? f.filename ?? "";
			for (const file of files) {
				if (!sameFile(path, file)) continue;
				matched.add(file);
				if (1 / (k + 1) > score) {
					score = 1 / (k + 1);
					frame = f;
				}
			}
		});
		if (score === 0) continue;
		const later =
			best !== null &&
			score === best.score &&
			(commit.committed_at ?? "") > (best.suspect.commit.committed_at ?? "");
		if (best === null || score > best.score || later) {
			best = {
				score,
				suspect: {
					commit: {
						sha: commit.sha,
						author: commit.author,
						committed_at: commit.committed_at,
						files: [...matched].sort(),
						frame: (frame as NormalizedFrame | null)?.function ?? null,
						url: issue.repository
							? `https://github.com/${issue.repository}/commit/${commit.sha}`
							: null,
					},
					message: commit.message,
				},
			};
		}
	}
	return best?.suspect ?? null;
}
