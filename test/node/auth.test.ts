import { describe, expect, it } from "vitest";
import {
	AUTH_ATTEMPT_LIMIT,
	AUTH_GLOBAL_LIMIT,
	allowAuthAttempt,
} from "../../src/core/auth/attempts.ts";
import {
	CHALLENGE_TTL_MS,
	finishSetup,
	finishSignIn,
	isSetupOpen,
	relyingPartyFor,
	setupOptions,
	signInOptions,
} from "../../src/core/auth/passkeys.ts";
import {
	createDevSession,
	deleteSession,
	getSession,
	SESSION_TTL_MS,
} from "../../src/core/auth/sessions.ts";
import { sql } from "../../src/ports/db.ts";
import { passkeyContract } from "../contract/passkey-contract.ts";
import { VirtualAuthenticator } from "../shared/virtual-authenticator.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "setup-admin-token-0123456789";
const CODE = "setup-code-0123456789abcdefghijklmnopqrstu";
const config = { adminToken: ADMIN, setupCode: CODE };
const rp = relyingPartyFor("https://checkend.example/setup");

passkeyContract("SQLite (Node)", async () => (await testPorts({ config })).ports, CODE);

async function setUp(name = "Simon") {
	const t = await testPorts({ config });
	const device = new VirtualAuthenticator(rp.origin);
	const options = await setupOptions(t.ports, rp, { code: CODE, name });
	if (!options.ok) throw new Error(options.error);
	const created = await finishSetup(t.ports, rp, {
		code: CODE,
		response: await device.create(options.value),
	});
	if (!created.ok) throw new Error(created.error);
	return { ...t, device, session: created.value };
}

describe("setup (first member)", () => {
	it("is open only while no member exists, and the code then does nothing", async () => {
		const { ports } = await setUp();
		expect(await isSetupOpen(ports.db)).toBe(false);
		expect(await setupOptions(ports, rp, { code: CODE, name: "Mallory" })).toEqual({
			ok: false,
			error: "setup_closed",
		});
	});

	it("rejects a wrong or missing code, and every code when SETUP_CODE is not set", async () => {
		const { ports } = await testPorts({ config });
		for (const code of ["wrong", "", undefined, null, 42, `${CODE}x`, CODE.slice(0, -1)]) {
			expect(await setupOptions(ports, rp, { code, name: "A" }), String(code)).toEqual({
				ok: false,
				error: "invalid_code",
			});
		}
		const unset = await testPorts({ config });
		expect(await setupOptions(unset.ports, rp, { code: "", name: "A" })).toEqual({
			ok: false,
			error: "invalid_code",
		});
	});

	it("does not accept the ADMIN_TOKEN as a setup code", async () => {
		const { ports } = await testPorts({ config });
		expect(await setupOptions(ports, rp, { code: ADMIN, name: "A" })).toEqual({
			ok: false,
			error: "invalid_code",
		});
	});

	it("needs no code for a development request (localhost, CHECKEND_DEV)", async () => {
		const { ports } = await testPorts({ config });
		const device = new VirtualAuthenticator(rp.origin);
		const options = await setupOptions(ports, rp, { code: undefined, name: "A", devRequest: true });
		if (!options.ok) throw new Error(options.error);
		const created = await finishSetup(ports, rp, {
			code: undefined,
			response: await device.create(options.value),
			devRequest: true,
		});
		expect(created.ok).toBe(true);
	});

	it("checks the code again when it finishes", async () => {
		const { ports } = await testPorts({ config });
		const device = new VirtualAuthenticator(rp.origin);
		const options = await setupOptions(ports, rp, { code: CODE, name: "A" });
		if (!options.ok) throw new Error(options.error);
		const result = await finishSetup(ports, rp, {
			code: "wrong",
			response: await device.create(options.value),
		});
		expect(result).toEqual({ ok: false, error: "invalid_code" });
		expect(await isSetupOpen(ports.db)).toBe(true);
	});

	it("creates only one member when two setups race", async () => {
		const { ports } = await testPorts({ config });
		const a = new VirtualAuthenticator(rp.origin);
		const b = new VirtualAuthenticator(rp.origin);
		const optionsA = await setupOptions(ports, rp, { code: CODE, name: "A" });
		const optionsB = await setupOptions(ports, rp, { code: CODE, name: "B" });
		if (!optionsA.ok || !optionsB.ok) throw new Error("options");
		const first = await finishSetup(ports, rp, {
			code: CODE,
			response: await a.create(optionsA.value),
		});
		const second = await finishSetup(ports, rp, {
			code: CODE,
			response: await b.create(optionsB.value),
		});
		expect(first.ok).toBe(true);
		expect(second).toEqual({ ok: false, error: "setup_closed" });
		expect(await ports.db.all(sql`SELECT name FROM members`)).toEqual([{ name: "A" }]);
		expect(await ports.db.all(sql`SELECT member_id FROM passkeys`)).toHaveLength(1);
	});

	it("requires user verification", async () => {
		const { ports } = await testPorts({ config });
		const device = new VirtualAuthenticator(rp.origin);
		device.userVerified = false;
		const options = await setupOptions(ports, rp, { code: CODE, name: "A" });
		if (!options.ok) throw new Error(options.error);
		expect(
			await finishSetup(ports, rp, { code: CODE, response: await device.create(options.value) }),
		).toEqual({ ok: false, error: "invalid_credential" });
	});

	it("writes the setup to the activity timeline", async () => {
		const { ports } = await setUp();
		expect(await ports.db.all(sql`SELECT actor_type, action, target_type FROM activity`)).toEqual([
			{ actor_type: "system", action: "member.setup", target_type: "member" },
		]);
	});
});

describe("sign-in", () => {
	it("rejects an unknown passkey", async () => {
		const { ports } = await setUp();
		const stranger = new VirtualAuthenticator(rp.origin);
		const options = await signInOptions(ports, rp);
		expect(await finishSignIn(ports, rp, await stranger.get(options))).toEqual({
			ok: false,
			error: "invalid_credential",
		});
	});

	it("rejects an expired challenge", async () => {
		const { ports, clock, device } = await setUp();
		const options = await signInOptions(ports, rp);
		clock.advance(CHALLENGE_TTL_MS + 1000);
		expect(await finishSignIn(ports, rp, await device.get(options))).toEqual({
			ok: false,
			error: "invalid_credential",
		});
	});

	it("rejects a signature counter that goes back (cloned authenticator)", async () => {
		const { ports, device } = await setUp();
		const ok = await finishSignIn(ports, rp, await device.get(await signInOptions(ports, rp)));
		expect(ok.ok).toBe(true);
		device.signCount = 0; // the next assertion has counter 1 again
		expect(await finishSignIn(ports, rp, await device.get(await signInOptions(ports, rp)))).toEqual(
			{ ok: false, error: "invalid_credential" },
		);
	});

	it("records the new counter and the last use", async () => {
		const { ports, device } = await setUp();
		await finishSignIn(ports, rp, await device.get(await signInOptions(ports, rp)));
		expect(await ports.db.first(sql`SELECT sign_count, last_used_at FROM passkeys`)).toEqual({
			sign_count: 1,
			last_used_at: "2026-10-10T12:00:00.000Z",
		});
	});

	it("rejects a malformed response without a server error", async () => {
		const { ports } = await setUp();
		await signInOptions(ports, rp);
		for (const response of [null, {}, { id: "x", response: {} }, "text"]) {
			expect(await finishSignIn(ports, rp, response)).toEqual({
				ok: false,
				error: "invalid_credential",
			});
		}
	});
});

describe("sessions", () => {
	it("stores only the SHA-256 hash of the session ID", async () => {
		const { ports, session } = await setUp();
		expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const rows = await ports.db.all(sql`SELECT * FROM sessions`);
		expect(JSON.stringify(rows)).not.toContain(session.token);
	});

	it("expires after the session lifetime", async () => {
		const { ports, clock, session } = await setUp();
		clock.advance(SESSION_TTL_MS - 1000);
		expect(await getSession(ports, session.token)).not.toBeNull();
		clock.advance(2000);
		expect(await getSession(ports, session.token)).toBeNull();
	});

	it("ends with sign-out", async () => {
		const { ports, session } = await setUp();
		await deleteSession(ports, session.token);
		expect(await getSession(ports, session.token)).toBeNull();
	});

	it("has a CSRF token per session", async () => {
		const { ports, session } = await setUp();
		const found = await getSession(ports, session.token);
		expect(found?.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(found?.csrfToken).not.toBe(session.token);
	});

	it("ignores unknown and malformed session IDs", async () => {
		const { ports } = await setUp();
		for (const token of ["", "x", "a".repeat(43), "a".repeat(5000)]) {
			expect(await getSession(ports, token)).toBeNull();
		}
	});

	it("creates a development session with a local member", async () => {
		const { ports } = await testPorts();
		const session = await createDevSession(ports);
		expect(await getSession(ports, session.token)).toMatchObject({
			memberName: "Developer (local)",
		});
		const again = await createDevSession(ports);
		expect(await ports.db.all(sql`SELECT id FROM members`)).toHaveLength(1);
		expect(again.token).not.toBe(session.token);
	});
});

describe("sign-in attempts", () => {
	it("allows a fixed number of attempts per client in a window", async () => {
		const { ports, clock } = await testPorts();
		for (let i = 0; i < AUTH_ATTEMPT_LIMIT; i++) {
			expect(await allowAuthAttempt(ports, "203.0.113.7")).toBe(true);
		}
		expect(await allowAuthAttempt(ports, "203.0.113.7")).toBe(false);
		expect(await allowAuthAttempt(ports, "198.51.100.1")).toBe(true);
		clock.advance(15 * 60_000);
		expect(await allowAuthAttempt(ports, "203.0.113.7")).toBe(true);
	});

	it("writes nothing for a client that is over the limit (D1 write budget)", async () => {
		const { ports } = await testPorts();
		for (let i = 0; i < AUTH_ATTEMPT_LIMIT + 50; i++) await allowAuthAttempt(ports, "203.0.113.7");
		expect(
			await ports.db.all(sql`SELECT key, count FROM auth_attempts WHERE key = ${"203.0.113.7"}`),
		).toEqual([{ key: "203.0.113.7", count: AUTH_ATTEMPT_LIMIT }]);
	});

	it("has a ceiling for all clients together, so many IPs cannot burn the write budget", async () => {
		const { ports } = await testPorts();
		for (let i = 0; i < AUTH_GLOBAL_LIMIT; i++) {
			expect(await allowAuthAttempt(ports, `198.51.100.${i % 250}-${i}`)).toBe(true);
		}
		expect(await allowAuthAttempt(ports, "192.0.2.1")).toBe(false);
	});
});
