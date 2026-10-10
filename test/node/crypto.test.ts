import { describe, expect, it } from "vitest";
import {
	decryptValue,
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
