import {
	type AuthenticationResponseJSON,
	generateAuthenticationOptions,
	generateRegistrationOptions,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	type RegistrationResponseJSON,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type Db, sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import type { Actor } from "../tokens.ts";
import { type NewSession, sessionStatements, sha256Hex } from "./sessions.ts";

/**
 * Passkeys (WebAuthn). The first member signs up through a one-time setup link: it carries the
 * SETUP_CODE secret in the URL fragment, and the browser sends the code in the request body.
 * A development request (CHECKEND_DEV on localhost) needs no code. Setup closes for good when a
 * member exists. Verification uses
 * SimpleWebAuthn, which needs only Web Crypto, so it runs the same in workerd and on Node.
 */

/** A challenge is valid for 5 minutes and is used once. */
export const CHALLENGE_TTL_MS = 5 * 60_000;

/** ES256, EdDSA, RS256. */
const ALGORITHMS = [-7, -8, -257];

export type AuthError =
	| "setup_closed"
	| "invalid_code"
	| "setup_expired"
	| "invalid_name"
	| "invalid_credential";
export type AuthResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

const fail = (error: AuthError): { ok: false; error: AuthError } => ({ ok: false, error });

export interface RelyingParty {
	/** The host name. A passkey works only on this host (and its subdomains are not used). */
	id: string;
	name: string;
	origin: string;
}

/** The relying party of a request URL: its host name and origin. */
export function relyingPartyFor(url: string): RelyingParty {
	const parsed = new URL(url);
	return { id: parsed.hostname, name: "Checkend", origin: parsed.origin };
}

export async function isSetupOpen(db: Db): Promise<boolean> {
	return (await db.first(sql`SELECT 1 AS found FROM members LIMIT 1`)) === null;
}

/** Who does the setup, in the activity timeline. */
const SETUP_ACTOR: Actor = { type: "system", id: null, name: "setup_link", scopes: [] };
const DEV_SETUP_ACTOR: Actor = { type: "system", id: null, name: "development", scopes: [] };

/** What a setup request carries. `devRequest`: CHECKEND_DEV and a direct localhost request. */
interface SetupInput {
	code: unknown;
	devRequest?: boolean;
}

/**
 * A setup link works for 24 hours: it is in deploy and build logs. The SETUP_CODE secret is
 * "<unix seconds>.<code>"; the link carries only the code.
 */
export const SETUP_CODE_TTL_MS = 24 * 3_600_000;

/** The value of the SETUP_CODE secret for a code made at `now`. */
export const storedSetupCode = (code: string, now: Date): string =>
	`${Math.floor(now.getTime() / 1000)}.${code}`;

/** The state of the SETUP_CODE secret. A value without a creation time (the old format) is expired. */
export function setupCodeState(
	stored: string | null,
	now: Date,
): { state: "missing" } | { state: "expired" } | { state: "valid"; code: string } {
	if (!stored) return { state: "missing" };
	const match = /^(\d{1,12})\.(.+)$/.exec(stored);
	if (!match?.[1] || !match[2]) return { state: "expired" };
	const age = now.getTime() - Number(match[1]) * 1000;
	// A creation time in the future (more than a clock skew) is not a code that setup-link made.
	if (age > SETUP_CODE_TTL_MS || age < -5 * 60_000) return { state: "expired" };
	return { state: "valid", code: match[2] };
}

async function checkCode(
	stored: string | null,
	input: SetupInput,
	now: Date,
): Promise<"ok" | "invalid_code" | "setup_expired"> {
	if (input.devRequest === true) return "ok";
	const given = input.code;
	const setup = setupCodeState(stored, now);
	if (setup.state === "missing") return "invalid_code";
	if (setup.state === "expired") return "setup_expired";
	if (typeof given !== "string" || given.length > 1024) return "invalid_code";
	const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(setup.code)]);
	let difference = 0;
	for (let i = 0; i < b.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0 ? "ok" : "invalid_code";
}

async function storeChallenge(
	db: Db,
	now: Date,
	challenge: string,
	purpose: "setup" | "signin",
	data: unknown,
): Promise<void> {
	const nowIso = now.toISOString();
	const expires = new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString();
	await db.batch([
		sql`DELETE FROM auth_challenges WHERE expires_at <= ${nowIso}`,
		sql`INSERT INTO auth_challenges (challenge, purpose, data, expires_at)
			VALUES (${challenge}, ${purpose}, ${data === undefined ? null : JSON.stringify(data)}, ${expires})`,
	]);
}

/** Deletes the challenge and returns its data. Null when it is unknown, expired or used. */
async function consumeChallenge(
	db: Db,
	now: Date,
	challenge: string,
	purpose: "setup" | "signin",
): Promise<{ data: unknown } | null> {
	if (challenge.length > 256) return null;
	const [deleted] = await db.batch([
		sql`DELETE FROM auth_challenges
			WHERE challenge = ${challenge} AND purpose = ${purpose} AND expires_at > ${now.toISOString()}
			RETURNING data`,
	]);
	const row = deleted?.rows[0];
	if (!row) return null;
	return { data: typeof row.data === "string" ? JSON.parse(row.data) : null };
}

function memberName(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim();
	return trimmed.length >= 1 && trimmed.length <= 100 ? trimmed : null;
}

/** Step 1 of setup: checks the setup code, then returns the passkey creation options. */
export async function setupOptions(
	{ db, clock, config }: Pick<Ports, "db" | "clock" | "config">,
	rp: RelyingParty,
	input: SetupInput & { name: unknown },
): Promise<AuthResult<PublicKeyCredentialCreationOptionsJSON>> {
	if (!(await isSetupOpen(db))) return fail("setup_closed");
	const code = await checkCode(config.setupCode, input, clock.now());
	if (code !== "ok") return fail(code);
	const name = memberName(input.name);
	if (!name) return fail("invalid_name");
	const options = await generateRegistrationOptions({
		rpName: rp.name,
		rpID: rp.id,
		userName: name,
		userDisplayName: name,
		userID: crypto.getRandomValues(new Uint8Array(32)),
		attestationType: "none",
		authenticatorSelection: { residentKey: "required", userVerification: "required" },
		supportedAlgorithmIDs: ALGORITHMS,
		timeout: CHALLENGE_TTL_MS,
	});
	await storeChallenge(db, clock.now(), options.challenge, "setup", {
		name,
		userHandle: options.user.id,
	});
	return { ok: true, value: options };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A response from the browser: only the outer shape is checked here; the library does the rest. */
function credentialShape(value: unknown): value is { id: string; response: object } {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		value.id.length > 0 &&
		value.id.length <= 1024 &&
		isRecord(value.response)
	);
}

/**
 * Step 2 of setup: verifies the new passkey, then creates the member, the passkey, an
 * activity row and a session in one atomic batch. The member is inserted only while no
 * member exists, so two setups at the same time create one member.
 */
export async function finishSetup(
	{ db, clock, config }: Pick<Ports, "db" | "clock" | "config">,
	rp: RelyingParty,
	input: SetupInput & { response: unknown },
): Promise<AuthResult<NewSession>> {
	const code = await checkCode(config.setupCode, input, clock.now());
	if (code !== "ok") return fail(code);
	if (!(await isSetupOpen(db))) return fail("setup_closed");
	if (!credentialShape(input.response)) return fail("invalid_credential");
	const now = clock.now();
	let stored: { name: string; userHandle: string } | null = null;
	let info: Awaited<ReturnType<typeof verifyRegistrationResponse>>["registrationInfo"];
	try {
		const result = await verifyRegistrationResponse({
			response: input.response as RegistrationResponseJSON,
			expectedChallenge: async (challenge) => {
				const found = await consumeChallenge(db, now, challenge, "setup");
				stored = found?.data as typeof stored;
				return found !== null;
			},
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			requireUserVerification: true,
			supportedAlgorithmIDs: ALGORITHMS,
		});
		if (!result.verified) return fail("invalid_credential");
		info = result.registrationInfo;
	} catch {
		return fail("invalid_credential");
	}
	const member = stored as { name: string; userHandle: string } | null;
	if (!member || !info) return fail("invalid_credential");

	const nowIso = now.toISOString();
	const { credential } = info;
	const actor = input.devRequest === true ? DEV_SETUP_ACTOR : SETUP_ACTOR;
	const { session, statements } = await sessionStatements(member.userHandle, now);
	const [inserted] = await db.batch([
		sql`INSERT INTO members (name, user_handle, created_at)
			SELECT ${member.name}, ${member.userHandle}, ${nowIso}
			WHERE NOT EXISTS (SELECT 1 FROM members)`,
		sql`INSERT INTO passkeys (member_id, credential_id, public_key, sign_count, transports, backed_up, created_at)
			SELECT id, ${credential.id}, ${credential.publicKey}, ${credential.counter},
				${credential.transports?.join(" ") ?? null}, ${info.credentialBackedUp ? 1 : 0}, ${nowIso}
			FROM members WHERE user_handle = ${member.userHandle}`,
		sql`INSERT INTO activity (at, actor_type, actor_id, actor_name, action, target_type, target_id, data)
			SELECT ${nowIso}, ${actor.type}, ${actor.id}, ${actor.name},
				${"member.setup"}, ${"member"}, id, ${JSON.stringify({ name: member.name })}
			FROM members WHERE user_handle = ${member.userHandle}`,
		...statements,
	]);
	if ((inserted?.changes ?? 0) === 0) return fail("setup_closed");
	return { ok: true, value: session };
}

/** Sign-in step 1: options for a discoverable passkey (no user name needed). */
export async function signInOptions(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	rp: RelyingParty,
): Promise<PublicKeyCredentialRequestOptionsJSON> {
	const options = await generateAuthenticationOptions({
		rpID: rp.id,
		userVerification: "required",
		timeout: CHALLENGE_TTL_MS,
	});
	await storeChallenge(db, clock.now(), options.challenge, "signin", undefined);
	return options;
}

/** Sign-in step 2: verifies the passkey response and creates a session. */
export async function finishSignIn(
	{ db, clock }: Pick<Ports, "db" | "clock">,
	rp: RelyingParty,
	response: unknown,
): Promise<AuthResult<NewSession>> {
	if (!credentialShape(response)) return fail("invalid_credential");
	const passkey = await db.first<{
		id: number;
		public_key: Uint8Array;
		sign_count: number;
		user_handle: string;
	}>(
		sql`SELECT p.id, p.public_key, p.sign_count, m.user_handle
			FROM passkeys p JOIN members m ON m.id = p.member_id WHERE p.credential_id = ${response.id}`,
	);
	if (!passkey) return fail("invalid_credential");
	const userHandle = (response.response as { userHandle?: unknown }).userHandle;
	if (userHandle !== undefined && userHandle !== passkey.user_handle) {
		return fail("invalid_credential");
	}
	const now = clock.now();
	let newCounter: number;
	try {
		const result = await verifyAuthenticationResponse({
			response: response as AuthenticationResponseJSON,
			expectedChallenge: async (challenge) =>
				(await consumeChallenge(db, now, challenge, "signin")) !== null,
			expectedOrigin: rp.origin,
			expectedRPID: rp.id,
			credential: {
				id: response.id,
				publicKey: new Uint8Array(passkey.public_key),
				counter: passkey.sign_count,
			},
			requireUserVerification: true,
		});
		if (!result.verified) return fail("invalid_credential");
		newCounter = result.authenticationInfo.newCounter;
	} catch {
		return fail("invalid_credential");
	}
	const { session, statements } = await sessionStatements(passkey.user_handle, now);
	await db.batch([
		sql`UPDATE passkeys SET sign_count = ${newCounter}, last_used_at = ${now.toISOString()}
			WHERE id = ${passkey.id}`,
		...statements,
	]);
	return { ok: true, value: session };
}
