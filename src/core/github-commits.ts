import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { markFixesDeployed } from "./fixes.ts";
import { GITHUB_ACTOR, MAX_FILES, MAX_MESSAGE_CHARS } from "./github.ts";
import { VERSION } from "./version.ts";

/**
 * Commits per release from the GitHub API, for deploys that push deliveries did not cover. The
 * cron calls it: with GITHUB_TOKEN, for one new deploy of a project with a repository per run,
 * it gets the commits since the previous deploy to the same environment (compare), and the
 * changed files of up to MAX_COMMIT_FETCHES of them. The deploy then contains these commits, so
 * fixes in them count as deployed, and the brief can name a suspect commit.
 */
const MAX_COMMIT_FETCHES = 20;
const DEPLOYS_PER_RUN = 1;
const TIMEOUT_MS = 10_000;

interface ApiCommit {
	sha?: unknown;
	commit?: { message?: unknown; author?: { date?: unknown } };
	author?: { login?: unknown } | null;
	files?: { filename?: unknown }[];
}

const isSha = (value: unknown): value is string =>
	typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

function commitRow(commit: ApiCommit, withFiles: boolean) {
	const files = withFiles
		? JSON.stringify(
				(commit.files ?? [])
					.map((f) => f.filename)
					.filter((f): f is string => typeof f === "string")
					.slice(0, MAX_FILES),
			)
		: null;
	const date = commit.commit?.author?.date;
	const login = commit.author?.login;
	return {
		sha: commit.sha as string,
		message: String(commit.commit?.message ?? "").slice(0, MAX_MESSAGE_CHARS),
		author: typeof login === "string" ? login.slice(0, 100) : null,
		committed_at: typeof date === "string" ? date.slice(0, 40) : null,
		files,
	};
}

/** Fetches the commits of new deploys. Returns the number of deploys handled. */
export async function fetchDeployCommits(ports: Ports): Promise<number> {
	const token = ports.config.githubToken;
	if (!token) return 0;
	const deploys = await ports.db.all<{
		id: number;
		uid: string;
		project_id: number;
		environment: string;
		commit_sha: string;
		repository: string;
		release: string;
	}>(
		sql`SELECT d.id, d.uid, d.project_id, d.environment, d.commit_sha, p.repository, r.version AS release
			FROM deploys d JOIN projects p ON p.id = d.project_id JOIN releases r ON r.id = d.release_id
			WHERE d.commits_status IS NULL AND p.repository IS NOT NULL
			ORDER BY d.id LIMIT ${DEPLOYS_PER_RUN}`,
	);
	const api = async (path: string): Promise<unknown> => {
		const response = await ports.http.send(
			`https://api.github.com/repos/${path}`,
			{
				method: "GET",
				signal: AbortSignal.timeout(TIMEOUT_MS),
				headers: {
					authorization: `Bearer ${token}`,
					accept: "application/vnd.github+json",
					"x-github-api-version": "2022-11-28",
					"user-agent": `Checkend/${VERSION}`,
				},
			},
			// A compare with many commits and files is a large JSON answer.
			{ maxBytes: 8 * 1024 * 1024 },
		);
		if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path.split("?")[0]}`);
		return response.json();
	};
	for (const deploy of deploys) {
		let status = "done";
		try {
			const previous = await ports.db.first<{ commit_sha: string }>(
				sql`SELECT commit_sha FROM deploys WHERE project_id = ${deploy.project_id}
					AND environment = ${deploy.environment} AND id < ${deploy.id} ORDER BY id DESC LIMIT 1`,
			);
			const repo = deploy.repository;
			let listed: ApiCommit[];
			if (previous && previous.commit_sha !== deploy.commit_sha) {
				const compare = (await api(
					`${repo}/compare/${previous.commit_sha}...${deploy.commit_sha}`,
				)) as {
					commits?: ApiCommit[];
				};
				listed = (compare.commits ?? []).filter((c) => isSha(c.sha));
			} else {
				listed = [{ sha: deploy.commit_sha }];
			}
			const known = new Set(
				(
					await ports.db.all<{ sha: string }>(
						sql`SELECT sha FROM commits WHERE project_id = ${deploy.project_id} AND files IS NOT NULL
							AND sha IN (SELECT value FROM json_each(${JSON.stringify(listed.map((c) => c.sha))}))`,
					)
				).map((r) => r.sha),
			);
			// The newest commits first: they are the most likely suspects.
			const toFetch = listed.filter((c) => !known.has(c.sha as string)).slice(-MAX_COMMIT_FETCHES);
			const fetched = await Promise.all(
				toFetch.map(async (c) =>
					commitRow((await api(`${repo}/commits/${c.sha}`)) as ApiCommit, true),
				),
			);
			const fetchedShas = new Set(fetched.map((c) => c.sha));
			const rows = [
				...fetched,
				...listed
					.filter((c) => !fetchedShas.has(c.sha as string) && !known.has(c.sha as string))
					.map((c) => commitRow(c, false)),
			];
			await ports.db.batch([
				// INSERT OR IGNORE keeps commits with files (from pushes); rows with files replace those without.
				sql`INSERT INTO commits (project_id, sha, message, author, committed_at, files)
					SELECT ${deploy.project_id}, json_extract(value, '$.sha'), json_extract(value, '$.message'),
						json_extract(value, '$.author'), json_extract(value, '$.committed_at'), json_extract(value, '$.files')
					FROM json_each(${JSON.stringify(rows)}) WHERE true
					ON CONFLICT (project_id, sha) DO UPDATE SET files = coalesce(commits.files, excluded.files),
						message = excluded.message, author = coalesce(excluded.author, commits.author),
						committed_at = coalesce(excluded.committed_at, commits.committed_at)`,
				sql`INSERT OR IGNORE INTO deploy_refs (deploy_id, kind, ref)
					SELECT ${deploy.id}, 'commit', value FROM json_each(${JSON.stringify(listed.map((c) => c.sha))})`,
			]);
			await markFixesDeployed(
				ports,
				GITHUB_ACTOR,
				deploy.uid,
				deploy.project_id,
				deploy.release,
				deploy.environment,
			);
		} catch (error) {
			status = "failed";
			// Workers Logs. Checkend never reports its own errors to itself (AGENTS.md).
			console.error(
				JSON.stringify({
					message: "checkend: GitHub commits fetch failed",
					deploy_id: deploy.id,
					error: String(error).slice(0, 300),
				}),
			);
		}
		await ports.db.run(sql`UPDATE deploys SET commits_status = ${status} WHERE id = ${deploy.id}`);
	}
	return deploys.length;
}
