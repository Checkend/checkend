import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordD1Bookmark } from "../../scripts/d1-bookmark.ts";
import { run as deploy, workerUrl } from "../../scripts/deploy.ts";
import { newSetupCode, run as setupLink } from "../../scripts/setup-link.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const URL_ = "https://errors.example.com";

async function setup() {
	const t = await testPorts();
	const app = createApp({ state: new IngestState() });
	const fetchFn = (input: string | URL | Request, init?: RequestInit) =>
		Promise.resolve(
			app.request(input instanceof Request ? input : String(input), init, { ports: t.ports }),
		);
	const lines: string[] = [];
	const calls: { args: string[]; stdin: string | undefined }[] = [];
	let wranglerExit = 0;
	const deps = {
		fetch: fetchFn,
		wrangler: async (args: string[], stdin?: string) => {
			calls.push({ args, stdin });
			return wranglerExit;
		},
		print: (line: string) => {
			lines.push(line);
		},
		sleep: async () => {},
	};
	return {
		...t,
		deps,
		lines,
		calls,
		failWrangler: () => {
			wranglerExit = 1;
		},
	};
}

describe("scripts/setup-link.ts", () => {
	it("stores a new code with wrangler through stdin, and prints it only in the link", async () => {
		const s = await setup();
		const code = await setupLink(
			["--url", `${URL_}/`, "--config", "wrangler.production.jsonc"],
			{},
			s.deps,
		);
		expect(code).toBe(0);
		expect(s.calls).toHaveLength(1);
		const [call] = s.calls;
		expect(call?.args).toEqual([
			"secret",
			"put",
			"SETUP_CODE",
			"--config",
			"wrangler.production.jsonc",
		]);
		const secret = call?.stdin ?? "";
		expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const withCode = s.lines.filter((line) => line.includes(secret));
		expect(withCode).toEqual([`Finish setup: ${URL_}/setup#${secret}`]);
	});

	it("uses CHECKEND_URL when --url is not given", async () => {
		const s = await setup();
		expect(await setupLink([], { CHECKEND_URL: URL_ }, s.deps)).toBe(0);
		expect(s.calls[0]?.args).toEqual(["secret", "put", "SETUP_CODE"]);
		expect(s.lines.join("\n")).toContain(`Finish setup: ${URL_}/setup#`);
	});

	it("does nothing when setup is closed", async () => {
		const s = await setup();
		await s.ports.db.run(
			sql`INSERT INTO members (name, user_handle, created_at) VALUES (${"Simon"}, ${"h"}, ${"2026-10-10T00:00:00Z"})`,
		);
		expect(await setupLink(["--url", URL_], {}, s.deps)).toBe(0);
		expect(s.calls).toEqual([]);
		expect(s.lines.join("\n")).not.toContain("/setup#");
		expect(s.lines.join("\n")).toContain("Setup is closed");
	});

	it("prints no link when wrangler fails", async () => {
		const s = await setup();
		s.failWrangler();
		expect(await setupLink(["--url", URL_], {}, s.deps)).toBe(1);
		expect(s.lines.join("\n")).not.toContain("/setup#");
	});

	it("stops when the Worker does not answer, and stores no code", async () => {
		const s = await setup();
		const deps = { ...s.deps, fetch: () => Promise.reject(new Error("offline")) };
		expect(await setupLink(["--url", URL_], {}, deps)).toBe(1);
		expect(s.calls).toEqual([]);
	});

	it("needs a URL", async () => {
		const s = await setup();
		expect(await setupLink([], {}, s.deps)).toBe(1);
		expect(s.lines.join("\n")).toContain("--url");
		expect(s.calls).toEqual([]);
	});

	it("makes a new random 32-byte code each time", () => {
		const a = newSetupCode();
		expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(newSetupCode()).not.toBe(a);
	});

	it("never writes the code to a file or passes it as an argument", () => {
		const source = readFileSync("scripts/setup-link.ts", "utf8");
		expect(source).not.toMatch(/writeFile|appendFile|createWriteStream|node:fs/);
	});
});

describe("scripts/deploy.ts", () => {
	function fakeDeploy(targets: string[], exits: { migrate?: number; deploy?: number } = {}) {
		const lines: string[] = [];
		const steps: string[] = [];
		const links: string[][] = [];
		let outputFile = "";
		const deps = {
			// Never the real helper here: it would run wrangler against an account.
			recordBookmark: (_config?: string) => {},
			wrangler: async (args: string[], env?: Record<string, string>) => {
				steps.push(args.join(" "));
				if (args[0] === "d1") return exits.migrate ?? 0;
				outputFile = env?.WRANGLER_OUTPUT_FILE_PATH ?? "";
				// What wrangler writes: one JSON line per entry.
				writeFileSync(
					outputFile,
					`${JSON.stringify({ type: "wrangler-session", version: 1 })}\n${JSON.stringify({ type: "deploy", version: 1, targets })}\n`,
				);
				return exits.deploy ?? 0;
			},
			setupLink: async (argv: string[]) => {
				links.push(argv);
				return 0;
			},
			print: (line: string) => {
				lines.push(line);
			},
		};
		return { deps, lines, steps, links, outputFile: () => outputFile };
	}

	it("records a D1 bookmark with the same config before the migrations", async () => {
		const d = fakeDeploy(["https://checkend.acme.workers.dev"]);
		const log = join(mkdtempSync(join(tmpdir(), "checkend-bookmark-")), "d1-bookmarks.jsonl");
		const order: string[] = [];
		// The builder's helper with a fake wrangler: `d1 time-travel info` answers JSON.
		const recordBookmark = (config?: string) => {
			recordD1Bookmark({
				...(config ? { config } : {}),
				log,
				run: (args) => {
					order.push(args.join(" "));
					return 'Some banner\n{"bookmark": "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683"}';
				},
			});
		};
		const wrangler = d.deps.wrangler;
		const deps = {
			...d.deps,
			recordBookmark,
			wrangler: (args: string[], env?: Record<string, string>) => {
				order.push(args.join(" "));
				return wrangler(args, env);
			},
		};
		expect(await deploy(["--config", "wrangler.production.jsonc"], {}, deps)).toBe(0);
		expect(order).toEqual([
			"d1 time-travel info DB --json --config wrangler.production.jsonc",
			"d1 migrations apply DB --remote --config wrangler.production.jsonc",
			"deploy --config wrangler.production.jsonc",
		]);
		expect(readFileSync(log, "utf8")).toContain(
			"npx wrangler d1 time-travel restore DB --bookmark=00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683 --config wrangler.production.jsonc",
		);
	});

	it("stops before the migrations when there is no bookmark", async () => {
		const d = fakeDeploy(["https://checkend.acme.workers.dev"]);
		const deps = {
			...d.deps,
			recordBookmark: (config?: string) => {
				recordD1Bookmark({
					...(config ? { config } : {}),
					log: join(mkdtempSync(join(tmpdir(), "checkend-bookmark-")), "log.jsonl"),
					run: () => "{}",
				});
			},
		};
		expect(await deploy([], {}, deps)).toBe(1);
		expect(d.steps).toEqual([]);
		expect(d.links).toEqual([]);
		expect(d.lines.join("\n")).toContain("No Time Travel bookmark");
	});

	it("applies the migrations, deploys, then makes the setup link for the deployed URL", async () => {
		const d = fakeDeploy(["https://checkend.acme.workers.dev"]);
		expect(await deploy(["--config", "wrangler.production.jsonc"], {}, d.deps)).toBe(0);
		expect(d.steps).toEqual([
			"d1 migrations apply DB --remote --config wrangler.production.jsonc",
			"deploy --config wrangler.production.jsonc",
		]);
		expect(d.links).toEqual([
			["--url", "https://checkend.acme.workers.dev", "--config", "wrangler.production.jsonc"],
		]);
		expect(existsSync(d.outputFile())).toBe(false);
	});

	it("stops when the migrations fail", async () => {
		const d = fakeDeploy([], { migrate: 1 });
		expect(await deploy([], {}, d.deps)).toBe(1);
		expect(d.steps).toEqual(["d1 migrations apply DB --remote"]);
		expect(d.links).toEqual([]);
	});

	it("makes no setup link when the deploy fails", async () => {
		const d = fakeDeploy(["https://checkend.acme.workers.dev"], { deploy: 1 });
		expect(await deploy([], {}, d.deps)).toBe(1);
		expect(d.links).toEqual([]);
	});

	it("explains the next step when it cannot find the Worker URL", async () => {
		const d = fakeDeploy(["schedule: */5 * * * *"]);
		expect(await deploy([], {}, d.deps)).toBe(0);
		expect(d.links).toEqual([]);
		expect(d.lines.join("\n")).toContain("npm run setup-link -- --url");
	});

	it("prefers CHECKEND_URL, then a custom domain, then a route, then workers.dev", async () => {
		const d = fakeDeploy(["https://checkend.acme.workers.dev"]);
		await deploy([], { CHECKEND_URL: "https://errors.acme.com" }, d.deps);
		expect(d.links[0]).toEqual(["--url", "https://errors.acme.com"]);

		expect(
			workerUrl([
				"https://checkend.acme.workers.dev",
				"errors.acme.com/* (zone name: acme.com)",
				"checkend.acme.com (custom domain)",
			]),
		).toBe("https://checkend.acme.com");
		expect(
			workerUrl(["https://checkend.acme.workers.dev", "errors.acme.com/* (zone name: acme.com)"]),
		).toBe("https://errors.acme.com");
		// A route on a path, or with a wildcard host, does not serve /setup.
		expect(
			workerUrl([
				"https://checkend.acme.workers.dev",
				"acme.com/errors/* (zone name: acme.com)",
				"*.acme.com/*",
			]),
		).toBe("https://checkend.acme.workers.dev");
		expect(workerUrl(["schedule: */5 * * * *"])).toBeNull();
	});

	it("never turns on development mode", () => {
		expect(readFileSync("scripts/deploy.ts", "utf8")).not.toContain("CHECKEND_DEV");
	});
});
