// Makes the one-time setup link of the web UI: the first member opens it to create a passkey.
//
//   npm run setup-link -- --url https://your-checkend.example [--config wrangler.production.jsonc]
//
// It asks GET /health whether setup is open. If it is, it makes a random code, stores it as the
// SETUP_CODE secret with `wrangler secret put` (the code goes through stdin: it is never an
// argument and never in a file), and prints the link. The code is in the URL fragment, so the
// browser never sends it in a URL. `npm run deploy` runs this script after each deploy.
// Runs on Node 22.18+ (type stripping).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { storedSetupCode } from "../src/core/auth/passkeys.ts";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;
/** Runs wrangler with these arguments; `stdin` is written to its standard input. */
export type Wrangler = (args: string[], stdin?: string) => Promise<number>;

const USAGE = `Usage: npm run setup-link -- --url <https://your-checkend> [--config <wrangler config>]

The URL can also come from CHECKEND_URL. Use the hostname that people will use every day:
a passkey works only on the hostname where it was made.`;

/** Health checks after a deploy: the new Worker can need some seconds to answer. */
const HEALTH_ATTEMPTS = 6;
const HEALTH_DELAY_MS = 5_000;

export function option(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
}

/** 32 random bytes, base64url (43 characters). */
export function newSetupCode(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

/** Runs the wrangler of this repository (npx). Its output goes to this terminal. */
export const runWrangler: Wrangler = (args, stdin) =>
	new Promise((resolve) => {
		const child = spawn("npx", ["--no-install", "wrangler", ...args], {
			stdio: [stdin === undefined ? "inherit" : "pipe", "inherit", "inherit"],
			shell: process.platform === "win32",
		});
		if (stdin !== undefined) child.stdin?.end(stdin);
		child.on("error", () => resolve(1));
		child.on("close", (code) => resolve(code ?? 1));
	});

async function setupOpen(
	origin: string,
	fetchFn: Fetch,
	sleep: (ms: number) => Promise<void>,
): Promise<boolean | null> {
	for (let attempt = 1; attempt <= HEALTH_ATTEMPTS; attempt++) {
		try {
			const response = await fetchFn(`${origin}/health`, {
				headers: { accept: "application/json" },
			});
			if (response.ok) {
				const body = (await response.json()) as { setup_open?: unknown };
				return typeof body.setup_open === "boolean" ? body.setup_open : null;
			}
		} catch {
			// Not reachable yet.
		}
		if (attempt < HEALTH_ATTEMPTS) await sleep(HEALTH_DELAY_MS);
	}
	return null;
}

export async function run(
	argv: string[],
	env: Env,
	deps: {
		fetch?: Fetch;
		wrangler?: Wrangler;
		print?: (line: string) => void;
		sleep?: (ms: number) => Promise<void>;
		now?: () => Date;
	} = {},
): Promise<number> {
	const {
		fetch: fetchFn = fetch,
		wrangler = runWrangler,
		print = console.log,
		sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		now = () => new Date(),
	} = deps;
	const given = option(argv, "url") ?? env.CHECKEND_URL;
	if (!given) {
		print(USAGE);
		return 1;
	}
	let origin: string;
	try {
		origin = new URL(given).origin;
	} catch {
		print(`Not a URL: ${given}\n\n${USAGE}`);
		return 1;
	}
	const config = option(argv, "config");
	const configArgs = config ? ["--config", config] : [];

	const open = await setupOpen(origin, fetchFn, sleep);
	if (open === false) {
		print("Setup is closed: this install has a member. No setup link is necessary.");
		return 0;
	}
	if (open === null) {
		print(`${origin}/health did not report setup_open. Check the URL and that the deploy worked.`);
		return 1;
	}

	const code = newSetupCode();
	// The secret holds the creation time too: the link expires after 24 hours.
	const stored = storedSetupCode(code, now());
	if ((await wrangler(["secret", "put", "SETUP_CODE", ...configArgs], stored)) !== 0) {
		print("wrangler secret put SETUP_CODE failed. No setup link was made.");
		return 1;
	}
	print("");
	print(`Finish setup: ${origin}/setup#${code}`);
	print("");
	print("Open the link to create the first member and its passkey. It works once, for 24 hours.");
	print("Keep it private until then. Run npm run setup-link again for a new link.");
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(2), process.env);
}
