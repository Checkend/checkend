import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const PAST = "2026-10-03T08:30:00.000Z";

async function sendWithDemoTime(origin: string, devMode: boolean) {
	const t = await testPorts({ config: { devMode } });
	const project = await createProject(t.ports, { name: "Demo" });
	const app = createApp({ state: new IngestState() });
	const response = await app.request(
		`${origin}/api/${project.id}/envelope/?sentry_key=${project.publicKey}`,
		{
			method: "POST",
			headers: { "x-checkend-demo-time": PAST },
			body: '{}\n{"type":"event"}\n{"message":"demo","timestamp":1791016200}\n',
		},
		{ ports: t.ports },
	);
	expect(response.status).toBe(200);
	await t.settle();
	return t.ports.db.first<{ first_seen: string }>(sql`SELECT first_seen FROM issues`);
}

describe("demo clock (development only)", () => {
	it("stores the event at the demo time with the development flag on localhost", async () => {
		expect(await sendWithDemoTime("http://localhost:8787", true)).toEqual({ first_seen: PAST });
	});

	it("ignores the header without the development flag", async () => {
		expect(await sendWithDemoTime("http://localhost:8787", false)).toEqual({
			first_seen: "2026-10-10T12:00:00.000Z",
		});
	});

	it("ignores the header for a host that is not local", async () => {
		expect(await sendWithDemoTime("https://checkend.example", true)).toEqual({
			first_seen: "2026-10-10T12:00:00.000Z",
		});
	});
});
