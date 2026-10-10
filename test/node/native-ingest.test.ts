import { describe, expect, it } from "vitest";
import { buildBrief } from "../../src/core/brief.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import type { Ports } from "../../src/ports/index.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "native-ingest-admin-token-0123";

async function setup(overrides: Partial<Ports> = {}) {
	const t = await testPorts({ ...overrides, config: { adminToken: ADMIN } });
	const project = await createProject(t.ports, { name: "Worker jobs" });
	const app = createApp({ state: new IngestState() });
	const send = async (query: string, body: unknown, headers: Record<string, string> = {}) => {
		const response = await app.request(
			`https://checkend.test/v1/ingest?${query}`,
			{
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: typeof body === "string" ? body : JSON.stringify(body),
			},
			{ ports: t.ports },
		);
		await t.settle();
		return {
			status: response.status,
			headers: response.headers,
			body: (await response.json()) as Record<string, any>,
		};
	};
	const key = { "x-checkend-key": project.publicKey };
	return { ...t, project, send, key };
}

const error = {
	type: "TypeError",
	message: "Cannot read properties of undefined (reading 'total') password=hunter2",
	level: "error",
	release: "jobs@3.1.0",
	environment: "production",
	frames: [
		{
			file: "/srv/jobs/src/invoice.ts",
			function: "sumInvoice",
			line: 42,
			in_app: true,
			context: {
				pre: ["function sumInvoice(invoice) {"],
				line: "  return invoice.lines.total;",
				post: ["}"],
			},
		},
		{ file: "/srv/jobs/src/run.ts", function: "runJob", line: 10, in_app: true },
		{ file: "/srv/jobs/node_modules/queue/index.js", function: "process", line: 99, in_app: false },
	],
	tags: { job: "invoices" },
	user: { id: "account-7" },
};

describe("POST /v1/ingest (native JSON)", () => {
	it("stores a simple JSON error as an issue, through the same pipeline as Sentry ingest", async () => {
		const { send, key, project, ports } = await setup();
		const response = await send(`project=${project.id}`, error, key);
		expect(response.status).toBe(200);
		expect(response.body.id).toMatch(/^[0-9a-f]{32}$/);
		const issue = await ports.db.first<{
			id: number;
			title: string;
			culprit: string;
			last_release: string;
		}>(sql`SELECT id, title, culprit, last_release FROM issues`);
		expect(issue).toMatchObject({
			title: "TypeError: Cannot read properties of undefined (reading 'total') password=[Filtered]",
			culprit: "sumInvoice (jobs/src/invoice.ts)",
			last_release: "jobs@3.1.0",
		});
		const brief = await buildBrief(ports.db, issue?.id ?? 0, ports.clock.now());
		expect(brief?.json.untrusted.exceptions[0]?.frames.map((f) => f.function)).toEqual([
			"sumInvoice",
			"runJob",
		]);
		expect(brief?.markdown).toContain(">  42 |   return invoice.lines.total;");
		expect(brief?.json.issue.users_affected).toBe(1);
	});

	it("accepts the project slug, and a message without a type", async () => {
		const { send, key, ports } = await setup();
		expect((await send("project=worker-jobs", { message: "Queue is full" }, key)).status).toBe(200);
		expect(await ports.db.first(sql`SELECT title FROM issues`)).toEqual({ title: "Queue is full" });
	});

	it("gives the same 401 for an unknown project and a wrong key, and never reads the key from the query", async () => {
		const { send, key, project } = await setup();
		const unknownProject = await send("project=1234567890", error, key);
		const wrongKey = await send(`project=${project.id}`, error, {
			"x-checkend-key": "0".repeat(32),
		});
		const keyInQuery = await send(`project=${project.id}&sentry_key=${project.publicKey}`, error);
		const bearer = await send(`project=${project.id}`, error, { authorization: `Bearer ${ADMIN}` });
		for (const response of [unknownProject, wrongKey, keyInQuery, bearer]) {
			expect(response.status).toBe(401);
			expect(response.body).toEqual(unknownProject.body);
		}
	});

	it("rejects a body without a type or a message, and a wrong shape, with 400", async () => {
		const { send, key, project } = await setup();
		expect((await send(`project=${project.id}`, { level: "error" }, key)).status).toBe(400);
		expect((await send(`project=${project.id}`, { message: 42 }, key)).status).toBe(400);
		expect(
			(await send(`project=${project.id}`, { message: "x", frames: "nope" }, key)).status,
		).toBe(400);
		expect((await send(`project=${project.id}`, "[1,2]", key)).status).toBe(400);
		expect((await send(`project=${project.id}`, "{nope", key)).status).toBe(400);
	});

	it("uses the same size caps (413) and back-pressure (429) as Sentry ingest", async () => {
		const big = await setup();
		const huge = JSON.stringify({ message: "x".repeat(1100 * 1024) });
		expect((await big.send(`project=${big.project.id}`, huge, big.key)).status).toBe(413);
		const limited = await setup({ rateLimiter: { allow: async () => false } });
		const response = await limited.send(`project=${limited.project.id}`, error, limited.key);
		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("60");
	});

	it("sends no CORS headers (browsers use the Sentry endpoints)", async () => {
		const { send, key, project } = await setup();
		const response = await send(`project=${project.id}`, error, key);
		expect(response.headers.get("access-control-allow-origin")).toBeNull();
	});
});
