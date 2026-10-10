/**
 * A software passkey authenticator for tests (ES256, attestation "none"). Web Crypto only, so
 * the same tests run on Node and in workerd. It builds the same JSON that a browser sends.
 */

const encoder = new TextEncoder();

export const base64url = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

export const fromBase64url = (text: string): Uint8Array =>
	Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const concat = (...parts: Uint8Array[]): Uint8Array<ArrayBuffer> => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
};

const sha256 = async (data: Uint8Array) =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(data)));

// --- minimal CBOR encoder (integers, byte strings, text strings, maps) -------------------

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function head(major: number, length: number): Uint8Array {
	if (length < 24) return Uint8Array.of((major << 5) | length);
	if (length < 256) return Uint8Array.of((major << 5) | 24, length);
	return Uint8Array.of((major << 5) | 25, length >> 8, length & 0xff);
}

function cbor(value: Cbor): Uint8Array {
	if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
	if (typeof value === "string") {
		const bytes = encoder.encode(value);
		return concat(head(3, bytes.byteLength), bytes);
	}
	if (value instanceof Uint8Array) return concat(head(2, value.byteLength), value);
	const parts = [head(5, value.size)];
	for (const [k, v] of value) parts.push(cbor(k), cbor(v));
	return concat(...parts);
}

// --- DER signature (WebAuthn ES256 signatures are ASN.1 DER, Web Crypto gives r || s) -------

function derInteger(bytes: Uint8Array): Uint8Array {
	let start = 0;
	while (start < bytes.length - 1 && bytes[start] === 0) start++;
	let value: Uint8Array = bytes.slice(start);
	if ((value[0] ?? 0) & 0x80) value = concat(Uint8Array.of(0), value);
	return concat(Uint8Array.of(0x02, value.byteLength), value);
}

function toDer(raw: Uint8Array): Uint8Array {
	const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
	return concat(Uint8Array.of(0x30, body.byteLength), body);
}

// --- the authenticator ------------------------------------------------------------------

interface KeyPair {
	publicKey: CryptoKey;
	privateKey: CryptoKey;
}

export interface CreationOptions {
	challenge: string;
	rp: { id?: string; name: string };
	user: { id: string; name: string };
}

export interface RequestOptions {
	challenge: string;
	rpId?: string;
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class VirtualAuthenticator {
	readonly credentialId = crypto.getRandomValues(new Uint8Array(32));
	signCount = 0;
	userHandle: string | null = null;
	/** Set false to act like an authenticator without user verification. */
	userVerified = true;
	private keys: KeyPair | null = null;

	constructor(readonly origin: string) {}

	get id(): string {
		return base64url(this.credentialId);
	}

	private async keyPair(): Promise<KeyPair> {
		this.keys ??= (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
			"sign",
			"verify",
		])) as KeyPair;
		return this.keys;
	}

	private flags(extra = 0): number {
		return FLAG_UP | (this.userVerified ? FLAG_UV : 0) | extra;
	}

	private counter(): Uint8Array {
		const n = this.signCount;
		return Uint8Array.of(n >>> 24, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
	}

	private clientData(type: string, challenge: string, origin: string): Uint8Array {
		return encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
	}

	/** navigator.credentials.create(): a registration response (RegistrationResponseJSON). */
	async create(options: CreationOptions, origin = this.origin) {
		const rpId = options.rp.id ?? new URL(origin).hostname;
		this.userHandle = options.user.id;
		const jwk = (await crypto.subtle.exportKey("jwk", (await this.keyPair()).publicKey)) as {
			x?: string;
			y?: string;
		};
		const coseKey = cbor(
			new Map<Cbor, Cbor>([
				[1, 2],
				[3, -7],
				[-1, 1],
				[-2, fromBase64url(jwk.x ?? "")],
				[-3, fromBase64url(jwk.y ?? "")],
			]),
		);
		const authData = concat(
			await sha256(encoder.encode(rpId)),
			Uint8Array.of(this.flags(FLAG_AT)),
			this.counter(),
			new Uint8Array(16),
			Uint8Array.of(0, this.credentialId.byteLength),
			this.credentialId,
			coseKey,
		);
		const attestationObject = cbor(
			new Map<Cbor, Cbor>([
				["fmt", "none"],
				["attStmt", new Map()],
				["authData", authData],
			]),
		);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key" as const,
			response: {
				clientDataJSON: base64url(this.clientData("webauthn.create", options.challenge, origin)),
				attestationObject: base64url(attestationObject),
				transports: ["internal" as const],
			},
			clientExtensionResults: {},
			authenticatorAttachment: "platform" as const,
		};
	}

	/** navigator.credentials.get(): an authentication response (AuthenticationResponseJSON). */
	async get(options: RequestOptions, origin = this.origin) {
		const rpId = options.rpId ?? new URL(origin).hostname;
		this.signCount++;
		const authenticatorData = concat(
			await sha256(encoder.encode(rpId)),
			Uint8Array.of(this.flags()),
			this.counter(),
		);
		const clientDataJSON = this.clientData("webauthn.get", options.challenge, origin);
		const signed = concat(authenticatorData, await sha256(clientDataJSON));
		const raw = new Uint8Array(
			await crypto.subtle.sign(
				{ name: "ECDSA", hash: "SHA-256" },
				(await this.keyPair()).privateKey,
				signed,
			),
		);
		return {
			id: this.id,
			rawId: this.id,
			type: "public-key" as const,
			response: {
				clientDataJSON: base64url(clientDataJSON),
				authenticatorData: base64url(authenticatorData),
				signature: base64url(toDer(raw)),
				...(this.userHandle ? { userHandle: this.userHandle } : {}),
			},
			clientExtensionResults: {},
			authenticatorAttachment: "platform" as const,
		};
	}
}
