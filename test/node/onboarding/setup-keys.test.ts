import { describe, expect, it } from "vitest";
import {
	authenticateSetupKey,
	createSetupKey,
	listSetupKeys,
	revokeSetupKey,
	SETUP_KEY_TTL_MS,
} from "../../../src/core/setup-keys.ts";
import { authenticate, BOOTSTRAP_ADMIN } from "../../../src/core/tokens.ts";
import { sql } from "../../../src/ports/db.ts";
import { testPorts } from "../../support/node-ports.ts";

describe("setup keys", () => {
	it("creates a cks_ key valid for 1 hour, stores only its hash, and writes activity", async () => {
		const { ports } = await testPorts();
		const created = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		expect(created.key).toMatch(/^cks_[A-Za-z0-9_-]{43}$/);
		expect(created.expires_at).toBe("2026-10-10T13:00:00.000Z");
		const row = await ports.db.first(sql`SELECT * FROM setup_keys`);
		expect(JSON.stringify(row)).not.toContain(created.key);
		expect(await ports.db.all(sql`SELECT action, target_type, target_id FROM activity`)).toEqual([
			{ action: "setup_key.create", target_type: "setup_key", target_id: created.id },
		]);
	});

	it("authenticates a key until it expires or is revoked", async () => {
		const { ports, clock } = await testPorts();
		const a = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		const actor = await authenticateSetupKey(ports, `Bearer ${a.key}`);
		expect(actor).toMatchObject({ type: "setup_key", id: a.id, scopes: [] });
		expect(actor?.name).toBe(`setup key ${a.key.slice(0, 8)}`);
		expect(await authenticateSetupKey(ports, `Bearer ${a.key}x`)).toBeNull();
		expect(await authenticateSetupKey(ports, "Bearer ck_notasetupkey")).toBeNull();
		clock.advance(SETUP_KEY_TTL_MS);
		expect(await authenticateSetupKey(ports, `Bearer ${a.key}`)).toBeNull();

		const b = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		expect(await revokeSetupKey(ports, BOOTSTRAP_ADMIN, b.id)).toBe(true);
		expect(await revokeSetupKey(ports, BOOTSTRAP_ADMIN, b.id)).toBe(false);
		expect(await authenticateSetupKey(ports, `Bearer ${b.key}`)).toBeNull();
	});

	it("is never an API token: authenticate() rejects it", async () => {
		const { ports } = await testPorts();
		const { key } = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		expect(await authenticate(ports, `Bearer ${key}`)).toBeNull();
	});

	it("lists the keys with their state and app count, never the key", async () => {
		const { ports, clock } = await testPorts();
		const a = await createSetupKey(ports, BOOTSTRAP_ADMIN);
		await createSetupKey(ports, BOOTSTRAP_ADMIN);
		await revokeSetupKey(ports, BOOTSTRAP_ADMIN, a.id);
		const keys = await listSetupKeys(ports.db, clock.now());
		expect(keys).toEqual([
			expect.objectContaining({
				id: a.id + 1,
				prefix: expect.stringMatching(/^cks_/),
				revoked_at: null,
				apps: 0,
				active: true,
			}),
			expect.objectContaining({ id: a.id, revoked_at: "2026-10-10T12:00:00.000Z", active: false }),
		]);
		expect(JSON.stringify(keys)).not.toContain(a.key);
	});
});
