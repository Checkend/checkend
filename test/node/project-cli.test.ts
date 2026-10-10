import { describe, expect, it } from "vitest";
import { run } from "../../scripts/project.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

const TOKEN = "cli-test-token-0123456789";

async function setup() {
	const t = await testPorts({ config: { adminToken: TOKEN } });
	const app = createApp({ state: new IngestState() });
	// The CLI's fetch goes into the app in memory.
	const fetchFn = (input: string | URL | Request, init?: RequestInit) =>
		Promise.resolve(
			app.request(input instanceof Request ? input : String(input), init, { ports: t.ports }),
		);
	const lines: string[] = [];
	const cli = (argv: string[], env: Record<string, string | undefined> = {}) =>
		run(
			argv,
			{ CHECKEND_URL: "https://errors.example.com", CHECKEND_ADMIN_TOKEN: TOKEN, ...env },
			fetchFn,
			(line) => {
				lines.push(line);
			},
		);
	return { cli, lines };
}

describe("scripts/project.ts", () => {
	it("creates a project and prints its DSN", async () => {
		const { cli, lines } = await setup();
		expect(await cli(["create", "--name", "My Shop", "--platform", "javascript"])).toBe(0);
		const output = lines.join("\n");
		expect(output).toMatch(/Created project [1-9]\d{9} \(my-shop\)/);
		expect(output).toMatch(/DSN: https:\/\/[0-9a-f]{32}@errors\.example\.com\/[1-9]\d{9}/);
	});

	it("prints JSON with --json", async () => {
		const { cli, lines } = await setup();
		expect(await cli(["create", "--name", "API", "--json"])).toBe(0);
		const data = JSON.parse(lines.join("\n"));
		expect(data).toMatchObject({ slug: "api", dsn: expect.stringMatching(/^https:\/\//) });
		expect(String(data.id)).toMatch(/^[1-9]\d{9}$/);
	});

	it("lists projects with their DSNs", async () => {
		const { cli, lines } = await setup();
		await cli(["create", "--name", "A"]);
		await cli(["create", "--name", "B"]);
		lines.length = 0;
		expect(await cli(["list"])).toBe(0);
		expect(lines.join("\n")).toMatch(
			/[1-9]\d{9}\s+a\s+A\s+https:\/\/[0-9a-f]{32}@errors\.example\.com\/[1-9]\d{9}/,
		);
		expect(lines.join("\n")).toMatch(/[1-9]\d{9}\s+b\s+B/);
	});

	it("fails with a clear message without URL or token, or with a wrong token", async () => {
		const { cli, lines } = await setup();
		expect(await cli(["list"], { CHECKEND_URL: undefined })).toBe(1);
		expect(lines.at(-1)).toMatch(/CHECKEND_URL/);
		expect(await cli(["list"], { CHECKEND_ADMIN_TOKEN: undefined })).toBe(1);
		expect(lines.at(-1)).toMatch(/CHECKEND_ADMIN_TOKEN/);
		expect(await cli(["list"], { CHECKEND_ADMIN_TOKEN: "wrong" })).toBe(1);
		expect(lines.at(-1)).toMatch(/401/);
	});

	it("prints usage for an unknown command or a missing name", async () => {
		const { cli, lines } = await setup();
		expect(await cli([])).toBe(2);
		expect(await cli(["create"])).toBe(2);
		expect(lines.join("\n")).toMatch(/Usage/);
	});
});
