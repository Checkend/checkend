import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { type CreatedProject, createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { withKey } from "../fixtures/sentry/with-key.ts";

const ports = () => cloudflarePorts(env, createExecutionContext());
let project: CreatedProject;

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
	project = await createProject(ports(), { name: "Fixture app" });
});

const decode = (base64: string) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

describe("Worker ingest on D1 (golden fixtures)", () => {
	it.each(env.TEST_SENTRY_FIXTURES.map((f) => [f.name, f] as const))(
		"stores %s as an issue and an event",
		async (_name, fixture) => {
			const query = new URL(`https://x${fixture.path}`).searchParams;
			query.set("sentry_key", project.publicKey);
			const response = await exports.default.fetch(
				new Request(`https://checkend.test/api/${project.id}/envelope/?${query}`, {
					method: "POST",
					headers: withKey(fixture.headers, project.publicKey),
					body: decode(fixture.bodyBase64),
				}),
			);
			expect(response.status).toBe(200);
			const { id } = (await response.json()) as { id: string };
			// The write runs after the response (ctx.waitUntil). Wait for it.
			const event = await vi.waitFor(
				async () => {
					const row = await ports().db.first<{ issue_id: number; raw: Uint8Array | null }>(
						sql`SELECT issue_id, raw FROM events WHERE event_id = ${id}`,
					);
					if (!row) throw new Error("not stored yet");
					return row;
				},
				{ timeout: 5000, interval: 20 },
			);
			expect(event.raw).toBeInstanceOf(Uint8Array);
			const issue = await ports().db.first<{ times_seen: number; fingerprint_version: number }>(
				sql`SELECT times_seen, fingerprint_version FROM issues WHERE id = ${event.issue_id}`,
			);
			expect(issue).toMatchObject({ fingerprint_version: 1 });
		},
	);
});

describe("Worker native ingest on D1", () => {
	it("stores a native JSON error sent with the project slug and the X-Checkend-Key header", async () => {
		const response = await exports.default.fetch(
			new Request("https://checkend.test/v1/ingest?project=fixture-app", {
				method: "POST",
				headers: { "content-type": "application/json", "x-checkend-key": project.publicKey },
				body: JSON.stringify({ type: "NativeError", message: "from the native endpoint" }),
			}),
		);
		expect(response.status).toBe(200);
		const { id } = (await response.json()) as { id: string };
		const row = await vi.waitFor(
			async () => {
				const found = await ports().db.first<{ title: string }>(
					sql`SELECT i.title FROM events e JOIN issues i ON i.id = e.issue_id WHERE e.event_id = ${id}`,
				);
				if (!found) throw new Error("not stored yet");
				return found;
			},
			{ timeout: 5000, interval: 20 },
		);
		expect(row.title).toBe("NativeError: from the native endpoint");
	});
});
