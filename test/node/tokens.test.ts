import { describe, expect, it } from "vitest";
import { listActivity } from "../../src/core/activity.ts";
import {
	type Actor,
	authenticate,
	createToken,
	hasScope,
	listTokens,
	revokeToken,
	SCOPES,
} from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "bootstrap-admin-token-0123456789";
const bootstrap: Actor = { type: "admin_token", id: null, name: "ADMIN_TOKEN", scopes: ["admin"] };

describe("scoped tokens", () => {
	it("creates a token, shows it once, and stores only its SHA-256 hash", async () => {
		const { ports } = await testPorts();
		const created = await createToken(ports, bootstrap, {
			name: "claude-code",
			scopes: ["issues:read"],
		});
		expect(created.token).toMatch(/^ck_[A-Za-z0-9_-]{43}$/);
		expect(created.record).toMatchObject({
			id: 1,
			name: "claude-code",
			scopes: ["issues:read"],
			prefix: created.token.slice(0, 10),
		});
		const row = await ports.db.first(sql`SELECT * FROM tokens`);
		expect(JSON.stringify(row)).not.toContain(created.token);
		const expected = [
			...new Uint8Array(
				await crypto.subtle.digest("SHA-256", new TextEncoder().encode(created.token)),
			),
		]
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
		expect(row?.token_hash).toBe(expected);
	});

	it("rejects unknown scopes and empty names", async () => {
		const { ports } = await testPorts();
		await expect(
			createToken(ports, bootstrap, { name: "x", scopes: ["root" as never] }),
		).rejects.toThrow(/scope/);
		await expect(
			createToken(ports, bootstrap, { name: " ", scopes: ["issues:read"] }),
		).rejects.toThrow(/name/);
		await expect(createToken(ports, bootstrap, { name: "x", scopes: [] })).rejects.toThrow(/scope/);
		expect(SCOPES).toEqual(["issues:read", "issues:write", "releases:write", "admin"]);
	});

	it("authenticates a token by its hash, and the bootstrap ADMIN_TOKEN", async () => {
		const { ports } = await testPorts({ config: { adminToken: ADMIN } });
		const { token } = await createToken(ports, bootstrap, {
			name: "ci",
			scopes: ["issues:read", "releases:write"],
		});
		expect(await authenticate(ports, `Bearer ${token}`)).toMatchObject({
			type: "token",
			id: 1,
			name: "ci",
			scopes: ["issues:read", "releases:write"],
		});
		expect(await authenticate(ports, `Bearer ${ADMIN}`)).toEqual(bootstrap);
		expect(await authenticate(ports, "Bearer ck_wrong")).toBeNull();
		expect(await authenticate(ports, null)).toBeNull();
		expect(await authenticate(ports, token)).toBeNull(); // no "Bearer"
	});

	it("rejects a revoked token, and records last use at most once per hour", async () => {
		const { ports, clock, settle } = await testPorts();
		const { token, record } = await createToken(ports, bootstrap, {
			name: "ci",
			scopes: ["issues:read"],
		});
		await authenticate(ports, `Bearer ${token}`);
		await settle();
		const used = async () =>
			(await ports.db.first<{ last_used_at: string | null }>(sql`SELECT last_used_at FROM tokens`))
				?.last_used_at;
		expect(await used()).toBe("2026-10-10T12:00:00.000Z");
		clock.advance(60_000);
		await authenticate(ports, `Bearer ${token}`);
		await settle();
		expect(await used()).toBe("2026-10-10T12:00:00.000Z");
		clock.advance(3600_000);
		await authenticate(ports, `Bearer ${token}`);
		await settle();
		expect(await used()).toBe("2026-10-10T13:01:00.000Z");
		expect(await revokeToken(ports, bootstrap, record.id)).toBe(true);
		expect(await authenticate(ports, `Bearer ${token}`)).toBeNull();
		expect(await revokeToken(ports, bootstrap, record.id)).toBe(false);
	});

	it("lists tokens without secrets or hashes", async () => {
		const { ports } = await testPorts();
		await createToken(ports, bootstrap, { name: "a", scopes: ["issues:read"] });
		const list = await listTokens(ports.db);
		expect(list).toEqual([
			{
				id: 1,
				name: "a",
				scopes: ["issues:read"],
				prefix: expect.stringMatching(/^ck_/),
				created_at: "2026-10-10T12:00:00.000Z",
				created_by: "ADMIN_TOKEN",
				last_used_at: null,
				revoked_at: null,
				// No app: a token for all apps.
				project_id: null,
				project_name: null,
			},
		]);
	});

	it("hasScope: admin includes every scope", () => {
		const reader: Actor = { type: "token", id: 1, name: "r", scopes: ["issues:read"] };
		expect(hasScope(reader, "issues:read")).toBe(true);
		expect(hasScope(reader, "issues:write")).toBe(false);
		expect(hasScope(bootstrap, "releases:write")).toBe(true);
	});
});

describe("activity (audit timeline)", () => {
	it("records each write with its actor, in the same batch as the write", async () => {
		const { ports } = await testPorts();
		const { record } = await createToken(ports, bootstrap, { name: "ci", scopes: ["issues:read"] });
		const ci: Actor = { type: "token", id: record.id, name: "ci", scopes: ["admin"] };
		await revokeToken(ports, ci, record.id);
		const activity = await listActivity(ports.db, { limit: 10 });
		expect(
			activity.map((a) => [a.action, a.actor_type, a.actor_name, a.target_type, a.target_id]),
		).toEqual([
			["token.revoke", "token", "ci", "token", 1],
			["token.create", "admin_token", "ADMIN_TOKEN", "token", 1],
		]);
		expect(JSON.parse(String(activity[1]?.data))).toEqual({ name: "ci", scopes: ["issues:read"] });
	});
});
