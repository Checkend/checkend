import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { parseEnvelope } from "../../src/core/ingest/envelope.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { loadSentryFixture } from "../fixtures/sentry/load.ts";
import { testPorts } from "../support/node-ports.ts";

/** The brief of one golden fixture: real requests of each SDK. */
async function briefOf(name: string) {
	const t = await testPorts();
	const project = await createProject(t.ports, { name: "SDKs" });
	const fixture = loadSentryFixture(name);
	const body =
		fixture.headers["content-encoding"] === "gzip"
			? new Uint8Array(gunzipSync(fixture.body))
			: fixture.body;
	const envelope = parseEnvelope(body);
	const prepared = await prepareEvent(
		envelope.event as Uint8Array,
		t.clock.now(),
		String(envelope.header.event_id),
	);
	await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
		sleep: async () => {},
	});
	const issue = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
	return buildBrief(t.ports.db, issue, t.clock.now());
}

describe("briefs of real SDK errors", () => {
	it.each([
		["python-type-error", "RuntimeError: Failed to load user 42", "show_profile", "capture.py"],
		[
			"ruby-type-error",
			"RuntimeError: Failed to load user 42 (RuntimeError)",
			"show_profile",
			"lib/capture.rb",
		],
		["php-type-error", "RuntimeException: Failed to load user 42", "showProfile", "capture.php"],
		[
			"go-type-error",
			"*fmt.wrapError: failed to show profile: load user 42: no such user",
			"main",
			"main.go",
		],
		[
			"dotnet-type-error",
			"System.InvalidOperationException: Failed to load user 42",
			"Profiles.Show",
			"Program.cs",
		],
	])(
		"%s: the title, and the top in-app frame with its function and file",
		async (name, title, fn, file) => {
			const brief = await briefOf(name);
			expect(brief?.json.untrusted.title).toBe(title);
			const raised = brief?.json.untrusted.exceptions[0]?.frames[0];
			expect(raised?.function).toContain(fn);
			expect(raised?.file).toMatch(new RegExp(`${file.replace(".", "\\.")}$`));
		},
	);

	it("keeps the cause chain (the raised error first)", async () => {
		const brief = await briefOf("python-type-error");
		expect(brief?.json.untrusted.exceptions.map((e) => e.type)).toEqual([
			"RuntimeError",
			"KeyError",
		]);
	});
});
