#!/usr/bin/env node
// @ts-check
// npx create-checkend [name]: sets up Checkend on your own Cloudflare account with Wrangler (for
// people who do not use the Deploy to Cloudflare button). It clones the newest Checkend release,
// creates a D1 database, writes wrangler.<name>.jsonc (git-ignored), applies the migrations,
// deploys the Worker, and prints how to sign in. It needs git, Node 22.18 or later, and a
// Wrangler login (npx wrangler login).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

export const REPOSITORY = "https://github.com/Checkend/checkend.git";
const RELEASE = /^v(\d+)\.(\d+)(?:\.(\d+))?$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/** A Worker name: lowercase letters, digits and dashes, 1 to 63 characters. */
export const isWorkerName = (/** @type {string} */ name) =>
	/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(name);

/** The newest release tag in `git ls-remote --tags` output, or null. */
export function newestReleaseTag(/** @type {string} */ lsRemote) {
	const tags = lsRemote
		.split("\n")
		.map((line) => line.split("refs/tags/")[1]?.trim() ?? "")
		.filter((tag) => RELEASE.test(tag));
	const key = (/** @type {string} */ tag) =>
		(RELEASE.exec(tag) ?? []).slice(1).map((n) => Number(n ?? 0));
	tags.sort((a, b) => {
		const x = key(a);
		const y = key(b);
		for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
		return 0;
	});
	return tags.at(-1) ?? null;
}

/** The database ID in the output of `wrangler d1 create`. */
export function databaseId(/** @type {string} */ output) {
	const id = UUID.exec(output)?.[0];
	if (!id) throw new Error("wrangler d1 create printed no database ID.");
	return id;
}

/** wrangler.<name>.jsonc from the repository's wrangler.jsonc: the Worker name and the database. */
export function workerConfig(
	/** @type {string} */ template,
	/** @type {string} */ name,
	/** @type {string} */ id,
) {
	const named = template.replace(/"name":\s*"checkend"/, `"name": "${name}"`);
	const withDb = named.replace(
		/"database_name":\s*"checkend",/,
		`"database_name": "${name}",\n\t\t\t"database_id": "${id}",`,
	);
	if (named === template || withDb === named) {
		throw new Error("wrangler.jsonc has an unexpected form; edit the config by hand.");
	}
	return withDb;
}

/** The workers.dev URL in the output of `wrangler deploy`, or null. */
export const workerUrl = (/** @type {string} */ output) =>
	/https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(output)?.[0] ?? null;

/**
 * @typedef {object} Deps
 * @property {(cmd: string, args: string[], options?: { cwd?: string; input?: string }) => string} run
 * @property {(question: string, fallback: string) => Promise<string>} ask
 * @property {(line: string) => void} log
 * @property {(path: string) => boolean} exists
 * @property {(path: string) => string} read
 * @property {(path: string, text: string) => void} write
 * @property {() => string} secret
 */

/**
 * The whole flow. Returns the Worker URL. Each step logs what it does; a failure stops it with
 * the step and what to do.
 * @param {{ name?: string | undefined; cwd: string }} options
 * @param {Deps} deps
 */
export async function createCheckend(options, deps) {
	const { run, log } = deps;
	try {
		run("git", ["--version"]);
	} catch {
		throw new Error("git is not installed. Install git, then run npx create-checkend again.");
	}
	if (!/logged in/i.test(run("npx", ["wrangler", "whoami"]))) {
		throw new Error("Wrangler is not logged in. Run: npx wrangler login");
	}
	const name = options.name ?? (await deps.ask("Worker name", "checkend"));
	if (!isWorkerName(name)) {
		throw new Error(`"${name}" is not a valid Worker name (lowercase letters, digits, dashes).`);
	}
	const dir = join(options.cwd, name);
	if (deps.exists(dir)) throw new Error(`The folder ${dir} exists. Choose another name.`);

	const tag = newestReleaseTag(run("git", ["ls-remote", "--tags", REPOSITORY]));
	log(`Cloning Checkend ${tag ?? "(main: no release yet)"} into ${dir}`);
	run("git", [
		"clone",
		"--quiet",
		"--depth",
		"1",
		...(tag ? ["--branch", tag] : []),
		REPOSITORY,
		dir,
	]);
	log("Installing the dependencies");
	run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir });

	log(`Creating the D1 database ${name}`);
	const id = databaseId(run("npx", ["wrangler", "d1", "create", name], { cwd: dir }));
	const config = `wrangler.${name}.jsonc`;
	deps.write(join(dir, config), workerConfig(deps.read(join(dir, "wrangler.jsonc")), name, id));
	log(`Wrote ${config} (git-ignored: your account's IDs stay out of the repository)`);

	log("Applying the migrations");
	run("npx", ["wrangler", "d1", "migrations", "apply", "DB", "--remote", "--config", config], {
		cwd: dir,
	});
	log("Deploying the Worker");
	const url = workerUrl(run("npx", ["wrangler", "deploy", "--config", config], { cwd: dir }));

	const scripts = /** @type {{ scripts?: Record<string, string> }} */ (
		JSON.parse(deps.read(join(dir, "package.json")))
	).scripts;
	if (scripts?.["setup-link"]) {
		// The first sign-in: a one-time link (the setup code), made by the repository's script.
		const link = run("npm", ["run", "--silent", "setup-link", "--", "--config", config], {
			cwd: dir,
		});
		log(`\nOpen this link to finish the setup (it expires):\n${link.trim()}`);
	} else {
		const token = deps.secret();
		run("npx", ["wrangler", "secret", "put", "ADMIN_TOKEN", "--config", config], {
			cwd: dir,
			input: token,
		});
		log(
			"\nYour admin token (shown once; keep it in a password manager):\n" +
				`${token}\n\nCreate a project: CHECKEND_URL=${url ?? "<your Worker URL>"} CHECKEND_ADMIN_TOKEN=<the token> npm run project -- create --name my-app`,
		);
	}
	log(`\nCheckend runs at ${url ?? "your workers.dev URL (see the deploy output)"}.`);
	log(`Deploy updates from ${dir} with: npx wrangler deploy --config ${config}`);
	return url;
}

/** @type {Deps} */
const nodeDeps = {
	run: (cmd, args, options = {}) =>
		execFileSync(cmd, args, {
			encoding: "utf8",
			cwd: options.cwd,
			input: options.input,
			stdio: [options.input === undefined ? "inherit" : "pipe", "pipe", "inherit"],
		}),
	async ask(question, fallback) {
		const rl = createInterface({ input: process.stdin, output: process.stdout });
		const answer = (await rl.question(`${question} (${fallback}): `)).trim();
		rl.close();
		return answer || fallback;
	},
	log: (line) => console.log(line),
	exists: existsSync,
	read: (path) => readFileSync(path, "utf8"),
	write: (path, text) => writeFileSync(path, text),
	secret: () => `ck_admin_${randomBytes(32).toString("base64url")}`,
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	createCheckend({ name: process.argv[2], cwd: process.cwd() }, nodeDeps).catch((error) => {
		console.error(`\ncreate-checkend: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	});
}
