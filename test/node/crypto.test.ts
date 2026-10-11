import { describe, expect, it } from "vitest";
import {
	decryptValue,
	deriveInstallKeys,
	type EncryptionKey,
	encryptValue,
	keyIdOf,
	parseEncryptionKeys,
} from "../../src/core/crypto.ts";

const key = (id: string, byte: number): EncryptionKey => ({
	id,
	key: new Uint8Array(32).fill(byte),
});
const k1 = key("k1", 1);
const k2 = key("k2", 2);

describe("encrypted values (AES-GCM with a key ID)", () => {
	it("encrypts with the first (current) key and stores its ID", async () => {
		const stored = await encryptValue([k2, k1], "whsec_secret", "webhooks.secret:7");
		expect(stored).toMatch(/^enc1:k2:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
		expect(stored).not.toContain("whsec_secret");
		expect(keyIdOf(stored)).toBe("k2");
		expect(await decryptValue([k2, k1], stored, "webhooks.secret:7")).toBe("whsec_secret");
	});

	it("decrypts a value of an older key while that key is listed (rotation)", async () => {
		const old = await encryptValue([k1], "token", "ctx");
		expect(await decryptValue([k2, k1], old, "ctx")).toBe("token");
		await expect(decryptValue([k2], old, "ctx")).rejects.toThrow(
			/key k1 is not in ENCRYPTION_KEYS/,
		);
	});

	it("uses a new IV each time, and binds the value to its context", async () => {
		const a = await encryptValue([k1], "same", "ctx");
		expect(await encryptValue([k1], "same", "ctx")).not.toBe(a);
		await expect(decryptValue([k1], a, "other-row")).rejects.toThrow();
		await expect(decryptValue([k1], `${a.slice(0, -2)}AA`, "ctx")).rejects.toThrow();
	});

	it("fails without keys", async () => {
		await expect(encryptValue([], "x", "ctx")).rejects.toThrow(/ENCRYPTION_KEYS/);
	});

	it("parses ENCRYPTION_KEYS: id:base64 pairs, 32-byte keys only", () => {
		const b64 = (byte: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(byte)));
		const parsed = parseEncryptionKeys(` k2:${b64(2)} , k1:${b64(1)}, bad:${btoa("short")}, :x `);
		expect(parsed.keys.map((k) => k.id)).toEqual(["k2", "k1"]);
		expect(parsed.keys[0]?.key).toEqual(new Uint8Array(32).fill(2));
		expect(parsed.invalid).toEqual(["bad", ""]);
		expect(parseEncryptionKeys(undefined)).toEqual({ keys: [], invalid: [] });
	});
});

describe("keys per install (HKDF)", () => {
	it("derives other key bytes for each install, with the same key IDs", async () => {
		const a = await deriveInstallKeys([k2, k1], "install-a");
		const b = await deriveInstallKeys([k2, k1], "install-b");
		expect(a.map((k) => k.id)).toEqual(["k2", "k1"]);
		expect(a.every((k) => k.key.byteLength === 32)).toBe(true);
		expect(a[0]?.key).not.toEqual(b[0]?.key);
		expect(a[0]?.key).not.toEqual(k2.key);
		// The same install: the same keys again (values stored earlier still decrypt).
		expect(await deriveInstallKeys([k2, k1], "install-a")).toEqual(a);
	});

	it("keeps the value of one install unreadable for another", async () => {
		const a = await deriveInstallKeys([k1], "install-a");
		const b = await deriveInstallKeys([k1], "install-b");
		const stored = await encryptValue(a, "whsec_secret", "webhooks.secret:7");
		expect(await decryptValue(a, stored, "webhooks.secret:7")).toBe("whsec_secret");
		await expect(decryptValue(b, stored, "webhooks.secret:7")).rejects.toThrow();
		await expect(decryptValue([k1], stored, "webhooks.secret:7")).rejects.toThrow();
	});

	it("refuses an empty install ID", async () => {
		await expect(deriveInstallKeys([k1], "")).rejects.toThrow();
	});
});
