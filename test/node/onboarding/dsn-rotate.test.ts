import { describe, expect, it } from "vitest";
import { createProject } from "../../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { ADMIN, setupApi } from "../../support/setup-api.ts";

describe("DSN key rotation", () => {
	it("adds a key, both keys work, then the old key is revoked and ingest rejects it", async () => {
		const { call, ports, app } = await setupApi();
		const project = await createProject(ports, { name: "Shop" });
		const send = (key: string) =>
			app.request(
				`/api/${project.id}/store/?sentry_key=${key}`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: '{"message":"x"}',
				},
				{ ports },
			);
		expect((await send(project.publicKey)).status).toBe(200);

		const added = await call("POST", `/v1/projects/${project.slug}/keys`, ADMIN);
		expect(added.status).toBe(201);
		const newKey = added.body?.data.public_key as string;
		expect(added.body?.data.dsn).toContain(`${newKey}@`);
		expect((await send(newKey)).status).toBe(200);
		expect((await send(project.publicKey)).status).toBe(200);

		expect(
			(await call("DELETE", `/v1/projects/${project.slug}/keys/${project.publicKey}`, ADMIN))
				.status,
		).toBe(204);
		// The same isolate forgets the key at once (other isolates within 60 s).
		expect((await send(project.publicKey)).status).toBe(401);
		expect((await send(newKey)).status).toBe(200);
		expect(
			(await call("DELETE", `/v1/projects/${project.slug}/keys/${project.publicKey}`, ADMIN))
				.status,
		).toBe(404);
		expect(
			await ports.db.all(
				sql`SELECT action FROM activity WHERE action LIKE 'project.key%' ORDER BY id`,
			),
		).toEqual([{ action: "project.key_create" }, { action: "project.key_revoke" }]);
	});

	it("does not revoke the last key, and needs admin", async () => {
		const { call, ports } = await setupApi();
		const project = await createProject(ports, { name: "Shop" });
		const last = await call(
			"DELETE",
			`/v1/projects/${project.slug}/keys/${project.publicKey}`,
			ADMIN,
		);
		expect(last.status).toBe(409);
		const { token } = await createToken(ports, BOOTSTRAP_ADMIN, {
			name: "w",
			scopes: ["issues:write"],
		});
		expect((await call("POST", `/v1/projects/${project.slug}/keys`, token)).status).toBe(403);
		expect((await call("POST", "/v1/projects/nope/keys", ADMIN)).status).toBe(404);
	});
});
