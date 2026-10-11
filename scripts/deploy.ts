// Deploys Checkend: records a D1 Time Travel bookmark (scripts/d1-bookmark.ts), applies the D1
// migrations, deploys the Worker, then makes the one-time setup link of the web UI while setup
// is open (scripts/setup-link.ts).
//
//   npm run deploy                     (wrangler.jsonc)
//   npm run deploy:production          (--config wrangler.production.jsonc)
//
// People only: agents do not deploy (AGENTS.md, rule 9). Runs on Node 22.18+ (type stripping).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordD1Bookmark } from "./d1-bookmark.ts";
import { option, run as setupLink } from "./setup-link.ts";

type Env = Record<string, string | undefined>;
/** Runs wrangler with these arguments and extra environment variables. */
type Wrangler = (args: string[], env?: Record<string, string>) => Promise<number>;

const runWrangler: Wrangler = (args, env) =>
	new Promise((resolve) => {
		const child = spawn("npx", ["--no-install", "wrangler", ...args], {
			stdio: "inherit",
			env: { ...process.env, ...env },
			shell: process.platform === "win32",
		});
		child.on("error", () => resolve(1));
		child.on("close", (code) => resolve(code ?? 1));
	});

/**
 * The URL for the setup link, from the targets that `wrangler deploy` reports. A custom domain
 * first, then a route for a whole host, then workers.dev: a passkey works only on the hostname
 * where it was made, so use the hostname that people will use.
 */
export function workerUrl(targets: string[]): string | null {
	const custom = targets.find((t) => t.includes("(custom domain"));
	if (custom) return `https://${custom.split(" ")[0]}`;
	for (const target of targets) {
		const pattern = target.split(" ")[0] ?? "";
		const match = /^([a-z0-9.-]+)\/\*$/i.exec(pattern);
		if (match) return `https://${match[1]}`;
	}
	return targets.find((t) => /^https:\/\/[^/\s]+\.workers\.dev$/.test(t)) ?? null;
}

/** The targets of the "deploy" entry in wrangler's output file (one JSON object per line). */
function deployTargets(file: string): string[] {
	let text = "";
	try {
		text = readFileSync(file, "utf8");
	} catch {
		return [];
	}
	for (const line of text.split("\n")) {
		try {
			const entry = JSON.parse(line) as { type?: unknown; targets?: unknown };
			if (entry.type === "deploy" && Array.isArray(entry.targets)) {
				return entry.targets.filter((t): t is string => typeof t === "string");
			}
		} catch {
			// Not a JSON line.
		}
	}
	return [];
}

export async function run(
	argv: string[],
	env: Env,
	deps: {
		wrangler?: Wrangler;
		setupLink?: (argv: string[]) => Promise<number>;
		/** Throws when there is no bookmark. */
		recordBookmark?: (config?: string) => void;
		print?: (line: string) => void;
	} = {},
): Promise<number> {
	const {
		wrangler = runWrangler,
		recordBookmark = (config?: string) => {
			recordD1Bookmark(config ? { config } : {});
		},
		setupLink: makeLink = (args: string[]) => setupLink(args, {}),
		print = console.log,
	} = deps;
	const config = option(argv, "config");
	const configArgs = config ? ["--config", config] : [];

	// The point to restore if the deploy goes wrong. Without it, the migrations do not run.
	try {
		recordBookmark(config);
	} catch (error) {
		print(error instanceof Error ? error.message : String(error));
		return 1;
	}

	const migrated = await wrangler(["d1", "migrations", "apply", "DB", "--remote", ...configArgs]);
	if (migrated !== 0) return migrated;

	const outputFile = join(tmpdir(), `checkend-deploy-${randomBytes(6).toString("hex")}.json`);
	let targets: string[];
	try {
		const deployed = await wrangler(["deploy", ...configArgs], {
			WRANGLER_OUTPUT_FILE_PATH: outputFile,
		});
		if (deployed !== 0) return deployed;
		targets = deployTargets(outputFile);
	} finally {
		rmSync(outputFile, { force: true });
	}

	const url = env.CHECKEND_URL || workerUrl(targets);
	const linkCommand = `npm run setup-link -- --url <https://your-checkend>${config ? ` --config ${config}` : ""}`;
	if (!url) {
		print(`The deploy worked. To make the setup link of the web UI, run: ${linkCommand}`);
		return 0;
	}
	if ((await makeLink(["--url", url, ...configArgs])) !== 0) {
		print(`The deploy worked, but the setup link failed. Run it again: ${linkCommand}`);
	}
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(2), process.env);
}
