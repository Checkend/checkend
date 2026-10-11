// Upstream sync for a copy of Checkend (a clone, or a repository that the Deploy to Cloudflare
// button made). It runs in the Upstream sync workflow: it fetches the release tags of the
// upstream repository, and when a newer release exists, it applies the changes between the
// release of this copy and the newest release on a new branch, and opens a pull request. It
// never merges, and it never changes the default branch.
//
//   UPSTREAM_URL=https://github.com/Checkend/checkend.git node scripts/upstream-sync.ts [--base v0.8]
//
// The release of this copy is the version in package.json (tag v<version>), or --base.
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = /^v(\d+)\.(\d+)(?:\.(\d+))?$/;

const parts = (tag: string) => {
	const m = RELEASE.exec(tag);
	return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};

/** Compares two release tags (v0.8 = v0.8.0). */
export function compareReleases(a: string, b: string): number {
	const x = parts(a) ?? [0, 0, 0];
	const y = parts(b) ?? [0, 0, 0];
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
	return 0;
}

/** The newest release tag that is newer than `base`, or null. Other tags are ignored. */
export function newestRelease(tags: string[], base: string): string | null {
	const newer = tags.filter((t) => RELEASE.test(t) && compareReleases(t, base) > 0);
	return newer.sort(compareReleases).at(-1) ?? null;
}

export const isRelease = (tag: string) => RELEASE.test(tag);

export type SyncResult =
	| { kind: "up_to_date" }
	| { kind: "proposed"; branch: string; from: string; to: string }
	| { kind: "branch_exists"; branch: string }
	| { kind: "conflict"; branch: string; from: string; to: string; message: string };

const git = (cwd: string, args: string[], input?: string) =>
	execFileSync("git", args, { cwd, encoding: "utf8", ...(input === undefined ? {} : { input }) });

/**
 * Fetches the upstream release tags (as refs/tags/upstream/<tag>), and when a newer release
 * exists, makes the branch checkend-upstream/<tag> with its changes, committed. Does not push.
 */
export function syncRelease(options: { cwd: string; upstream: string; base: string }): SyncResult {
	const { cwd, upstream, base } = options;
	if (!isRelease(base))
		throw new Error(`The base release "${base}" is not a release tag (v0.8 or v0.8.1).`);
	git(cwd, ["fetch", "--quiet", "--no-tags", upstream, "+refs/tags/v*:refs/tags/upstream/v*"]);
	const tags = git(cwd, ["tag", "--list", "upstream/v*"])
		.split("\n")
		.map((t) => t.trim().replace(/^upstream\//, ""))
		.filter(Boolean);
	if (!tags.includes(base)) {
		throw new Error(
			`The upstream repository has no tag ${base}. Run the workflow with the input "base".`,
		);
	}
	const to = newestRelease(tags, base);
	if (!to) return { kind: "up_to_date" };
	const branch = `checkend-upstream/${to}`;
	const remote = git(cwd, ["ls-remote", "--heads", "origin", branch]).trim();
	const local = git(cwd, ["branch", "--list", branch]).trim();
	if (remote || local) return { kind: "branch_exists", branch };
	git(cwd, ["switch", "--quiet", "-c", branch]);
	const diff = git(cwd, ["diff", "--binary", `upstream/${base}`, `upstream/${to}`]);
	try {
		if (diff) git(cwd, ["apply", "--3way", "--index", "--whitespace=nowarn"], diff);
	} catch (error) {
		return {
			kind: "conflict",
			branch,
			from: base,
			to,
			message: String((error as { stderr?: string }).stderr ?? error).slice(0, 2000),
		};
	}
	git(cwd, ["commit", "--quiet", "--allow-empty", "-m", `Update Checkend from ${base} to ${to}`]);
	return { kind: "proposed", branch, from: base, to };
}

function main(args: string[]) {
	const upstream = process.env.UPSTREAM_URL ?? "https://github.com/Checkend/checkend.git";
	const i = args.indexOf("--base");
	const version = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;
	const base = i >= 0 ? (args[i + 1] ?? "") : `v${version}`;
	const result = syncRelease({ cwd: process.cwd(), upstream, base });
	const summary = (text: string) => {
		console.log(text);
		if (process.env.GITHUB_STEP_SUMMARY)
			appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
	};
	if (result.kind === "up_to_date") summary(`Checkend ${base} is the newest release.`);
	if (result.kind === "branch_exists") summary(`The branch ${result.branch} already exists.`);
	if (result.kind === "conflict") {
		summary(
			`The changes from ${result.from} to ${result.to} do not apply cleanly to this copy. Update by hand:\n` +
				"git fetch <upstream> --tags, then compare the two tags, and keep your own changes.\n\n" +
				`\`\`\`\n${result.message}\n\`\`\``,
		);
		process.exitCode = 1;
	}
	if (result.kind === "proposed") {
		summary(`Proposed ${result.from} → ${result.to} on the branch ${result.branch}.`);
		if (process.env.GITHUB_OUTPUT) {
			appendFileSync(
				process.env.GITHUB_OUTPUT,
				`branch=${result.branch}\nfrom=${result.from}\nto=${result.to}\n`,
			);
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(2));
}
