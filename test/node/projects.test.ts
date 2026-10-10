import { describe, expect, it } from "vitest";
import { createProject, KeyCache, listProjects, slugify } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

describe("projects", () => {
	it("creates a project with a slug and a 32-character hex DSN key", async () => {
		const { ports } = await testPorts();
		const project = await createProject(ports, { name: "My Shop (web)", platform: "javascript" });
		expect(String(project.id)).toMatch(/^[1-9]\d{9}$/);
		expect(project).toMatchObject({
			name: "My Shop (web)",
			slug: "my-shop-web",
			platform: "javascript",
		});
		expect(project.publicKey).toMatch(/^[0-9a-f]{32}$/);
		expect(project.createdAt).toBe("2026-10-10T12:00:00.000Z");
	});

	it("makes the slug unique", async () => {
		const { ports } = await testPorts();
		await createProject(ports, { name: "API" });
		expect((await createProject(ports, { name: "api" })).slug).toBe("api-2");
	});

	it("rejects an empty or very long name", async () => {
		const { ports } = await testPorts();
		await expect(createProject(ports, { name: "  " })).rejects.toThrow(/name/);
		await expect(createProject(ports, { name: "x".repeat(101) })).rejects.toThrow(/name/);
	});

	it("lists projects with their active keys", async () => {
		const { ports } = await testPorts();
		const a = await createProject(ports, { name: "A" });
		await createProject(ports, { name: "B" });
		const list = await listProjects(ports.db);
		expect(list.map((p) => p.slug)).toEqual(["a", "b"]);
		expect(list[0]?.keys).toEqual([a.publicKey]);
	});

	it("slugify keeps letters and digits", () => {
		expect(slugify("  Hello, Wörld 2!  ")).toBe("hello-w-rld-2");
		expect(slugify("!!!")).toBe("project");
	});
});

describe("KeyCache", () => {
	it("finds an active key for the right project only", async () => {
		const { ports } = await testPorts();
		const p = await createProject(ports, { name: "A" });
		const cache = new KeyCache();
		const now = ports.clock.now();
		expect(await cache.find(ports.db, p.id, p.publicKey, now)).toEqual({ projectId: p.internalId });
		expect(await cache.find(ports.db, p.id + 1, p.publicKey, now)).toBeNull();
		expect(await cache.find(ports.db, p.id, "0".repeat(32), now)).toBeNull();
	});

	it("caches results for 60 seconds, so a revoked key works until the cache expires", async () => {
		const { ports, clock } = await testPorts();
		const p = await createProject(ports, { name: "A" });
		const cache = new KeyCache();
		expect(await cache.find(ports.db, p.id, p.publicKey, clock.now())).not.toBeNull();
		await ports.db.run(sql`UPDATE project_keys SET revoked_at = ${"2026-10-10T12:00:01Z"}`);
		expect(await cache.find(ports.db, p.id, p.publicKey, clock.now())).not.toBeNull();
		clock.advance(61_000);
		expect(await cache.find(ports.db, p.id, p.publicKey, clock.now())).toBeNull();
	});

	it("does not let unknown keys push valid keys out of the cache", async () => {
		const { ports } = await testPorts();
		const p = await createProject(ports, { name: "A" });
		const cache = new KeyCache(3);
		const now = ports.clock.now();
		await cache.find(ports.db, p.id, p.publicKey, now);
		for (let i = 0; i < 50; i++)
			await cache.find(ports.db, p.id, i.toString(16).padStart(32, "f"), now);
		// Revoke in D1: a cached valid key is still found, so it was not evicted.
		await ports.db.run(sql`UPDATE project_keys SET revoked_at = ${"2026-10-10T12:00:01Z"}`);
		expect(await cache.find(ports.db, p.id, p.publicKey, now)).toEqual({ projectId: p.internalId });
	});

	it("keeps a bounded number of entries", async () => {
		const { ports } = await testPorts();
		const cache = new KeyCache(3);
		for (let i = 0; i < 10; i++)
			await cache.find(ports.db, 1, i.toString(16).padStart(32, "0"), ports.clock.now());
		expect(cache.size).toBeLessThanOrEqual(3);
	});
});
