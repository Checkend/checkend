import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	createCheckend,
	databaseId,
	isWorkerName,
	newestReleaseTag,
	workerConfig,
	workerUrl,
} from "../../packages/create-checkend/create-checkend.mjs";

const ID = "4b1c2d3e-0000-4000-8000-123456789abc";
const wranglerJsonc = readFileSync("wrangler.jsonc", "utf8");

function fakeDeps(options: { scripts?: Record<string, string>; loggedIn?: boolean } = {}) {
	const calls: string[] = [];
	const files = new Map<string, string>();
	const logs: string[] = [];
	const inputs: string[] = [];
	return {
		calls,
		files,
		logs,
		inputs,
		deps: {
			run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}) {
				const line = [cmd, ...args].join(" ");
				calls.push(line);
				if (opts.input !== undefined) inputs.push(opts.input);
				if (line === "npx wrangler whoami")
					return options.loggedIn === false
						? "You are not authenticated."
						: "You are logged in with an OAuth Token";
				if (line.startsWith("git ls-remote"))
					return "abc\trefs/tags/v0.8\ndef\trefs/tags/v0.10\n123\trefs/tags/v-rails-final\n";
				if (line.startsWith("git clone")) {
					files.set("/work/errors/wrangler.jsonc", wranglerJsonc);
					files.set(
						"/work/errors/package.json",
						JSON.stringify({ scripts: options.scripts ?? {} }),
					);
				}
				if (line.includes("d1 create"))
					return `✅ Created\n{ "d1_databases": [{ "binding": "DB", "database_name": "errors", "database_id": "${ID}" }] }`;
				if (line.includes("wrangler deploy"))
					return "Uploaded errors\nDeployed errors triggers\n  https://errors.acme.workers.dev\n";
				if (line.includes("setup-link")) return "https://errors.acme.workers.dev/setup#code123\n";
				return "";
			},
			ask: async (_q: string, fallback: string) => fallback,
			log: (line: string) => logs.push(line),
			exists: (path: string) => path === "/work/taken",
			read: (path: string) => files.get(path) ?? "",
			write: (path: string, text: string) => files.set(path, text),
			secret: () => "ck_admin_test_secret_value",
		},
	};
}

describe("create-checkend helpers", () => {
	it("validates names, finds the newest release, the database ID and the URL", () => {
		expect(isWorkerName("my-errors")).toBe(true);
		expect(isWorkerName("My Errors")).toBe(false);
		expect(isWorkerName("-x")).toBe(false);
		expect(
			newestReleaseTag("a\trefs/tags/v0.9\nb\trefs/tags/v0.10\nc\trefs/tags/v-rails-final"),
		).toBe("v0.10");
		expect(newestReleaseTag("")).toBeNull();
		expect(databaseId(`database_id = "${ID}"`)).toBe(ID);
		expect(() => databaseId("error")).toThrow(/no database ID/);
		expect(workerUrl("x https://a-b.c.workers.dev y")).toBe("https://a-b.c.workers.dev");
	});

	it("writes the Worker config from the repository's wrangler.jsonc", () => {
		const config = workerConfig(wranglerJsonc, "errors", ID);
		expect(config).toContain('"name": "errors"');
		expect(config).toContain(`"database_id": "${ID}"`);
		expect(config).toContain('"database_name": "errors"');
		expect(() => workerConfig("{}", "errors", ID)).toThrow(/unexpected form/);
	});
});

describe("createCheckend", () => {
	it("clones the newest release, creates D1, writes the config, migrates, deploys, and sets an admin token", async () => {
		const { deps, calls, files, logs, inputs } = fakeDeps();
		const url = await createCheckend({ name: "errors", cwd: "/work" }, deps);
		expect(url).toBe("https://errors.acme.workers.dev");
		expect(calls).toEqual([
			"git --version",
			"npx wrangler whoami",
			"git ls-remote --tags https://github.com/Checkend/checkend.git",
			"git clone --quiet --depth 1 --branch v0.10 https://github.com/Checkend/checkend.git /work/errors",
			"npm ci --no-audit --no-fund",
			"npx wrangler d1 create errors",
			"npx wrangler d1 migrations apply DB --remote --config wrangler.errors.jsonc",
			"npx wrangler deploy --config wrangler.errors.jsonc",
			"npx wrangler secret put ADMIN_TOKEN --config wrangler.errors.jsonc",
		]);
		expect(files.get("/work/errors/wrangler.errors.jsonc")).toContain(ID);
		// The token goes to wrangler through stdin, never as an argument.
		expect(inputs).toEqual(["ck_admin_test_secret_value"]);
		expect(calls.join("\n")).not.toContain("ck_admin_test_secret_value");
		expect(logs.join("\n")).toContain("ck_admin_test_secret_value");
	});

	it("uses the setup link of the repository when it has the script, and sets no admin token", async () => {
		const { deps, calls, logs } = fakeDeps({
			scripts: { "setup-link": "node scripts/setup-link.ts" },
		});
		await createCheckend({ name: "errors", cwd: "/work" }, deps);
		expect(calls.at(-1)).toBe("npm run --silent setup-link -- --config wrangler.errors.jsonc");
		expect(calls.join("\n")).not.toContain("secret put");
		expect(logs.join("\n")).toContain("https://errors.acme.workers.dev/setup#code123");
	});

	it("stops early: no Wrangler login, a bad name, or a folder that exists", async () => {
		await expect(
			createCheckend({ name: "errors", cwd: "/work" }, fakeDeps({ loggedIn: false }).deps),
		).rejects.toThrow(/wrangler login/);
		await expect(
			createCheckend({ name: "Bad Name", cwd: "/work" }, fakeDeps().deps),
		).rejects.toThrow(/not a valid Worker name/);
		const taken = fakeDeps();
		await expect(createCheckend({ name: "taken", cwd: "/work" }, taken.deps)).rejects.toThrow(
			/exists/,
		);
		expect(taken.calls.some((c) => c.startsWith("git clone"))).toBe(false);
	});
});
