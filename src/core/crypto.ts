/**
 * Encrypted values for secrets that Checkend must read again (for example the signing secret
 * of a webhook): AES-256-GCM. The stored text names its key: "enc1:<key id>:<iv>:<ciphertext>".
 * ENCRYPTION_KEYS lists the keys, the current key first: "k2:<base64>,k1:<base64>". To rotate,
 * put a new key first and keep the old key; a scheduled job encrypts old values again with
 * the current key, and then the old key can go.
 *
 * The context (for example "webhooks.secret:7") is the additional data: a value copied to
 * another row or column does not decrypt.
 */
export interface EncryptionKey {
	id: string;
	/** 32 bytes. */
	key: Uint8Array;
}

const VERSION = "enc1";
const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array) =>
	btoa(String.fromCharCode(...bytes))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");

const fromBase64 = (text: string) =>
	Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const importKey = (key: EncryptionKey) =>
	crypto.subtle.importKey("raw", new Uint8Array(key.key), "AES-GCM", false, ["encrypt", "decrypt"]);

/** Encrypts with the current key (the first one). */
export async function encryptValue(
	keys: readonly EncryptionKey[],
	plaintext: string,
	context: string,
): Promise<string> {
	const current = keys[0];
	if (!current) throw new Error("ENCRYPTION_KEYS is not set: Checkend cannot store secrets.");
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: encoder.encode(context) },
		await importKey(current),
		encoder.encode(plaintext),
	);
	return `${VERSION}:${current.id}:${toBase64Url(iv)}:${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** The key ID of a stored value, or null when it is not an encrypted value. */
export function keyIdOf(stored: string): string | null {
	const parts = stored.split(":");
	return parts.length === 4 && parts[0] === VERSION ? (parts[1] ?? null) : null;
}

export async function decryptValue(
	keys: readonly EncryptionKey[],
	stored: string,
	context: string,
): Promise<string> {
	const [version, id, iv, ciphertext] = stored.split(":");
	if (version !== VERSION || !id || !iv || !ciphertext) throw new Error("Not an encrypted value.");
	const key = keys.find((k) => k.id === id);
	if (!key) throw new Error(`The key ${id} is not in ENCRYPTION_KEYS.`);
	const plaintext = await crypto.subtle.decrypt(
		{ name: "AES-GCM", iv: fromBase64(iv), additionalData: encoder.encode(context) },
		await importKey(key),
		fromBase64(ciphertext),
	);
	return new TextDecoder().decode(plaintext);
}

/** Parses ENCRYPTION_KEYS. Entries that are not "<id>:<base64 of 32 bytes>" are invalid. */
export function parseEncryptionKeys(value: string | undefined): {
	keys: EncryptionKey[];
	invalid: string[];
} {
	const keys: EncryptionKey[] = [];
	const invalid: string[] = [];
	for (const entry of (value ?? "").split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [id = "", base64 = ""] = trimmed.split(":");
		let key: Uint8Array | null = null;
		try {
			key = fromBase64(base64);
		} catch {
			key = null;
		}
		if (/^[A-Za-z0-9_-]{1,32}$/.test(id) && key?.byteLength === 32) keys.push({ id, key });
		else invalid.push(id);
	}
	return { keys, invalid };
}
