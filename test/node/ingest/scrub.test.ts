import { describe, expect, it } from "vitest";
import { FILTERED, scrub } from "../../../src/core/ingest/scrub.ts";

describe("scrub", () => {
	it.each([
		"password",
		"passwd",
		"Password",
		"user_password",
		"secret",
		"client_secret",
		"api_key",
		"apiKey",
		"x-api-key",
		"token",
		"access_token",
		"refreshToken",
		"authorization",
		"Authorization",
		"cookie",
		"set-cookie",
		"session",
		"sessionid",
		"csrf",
		"xsrf-token",
		"credit_card",
		"card_number",
		"cvv",
		"ssn",
		"private_key",
		"dsn",
	])("filters the value of key %s", (key) => {
		expect(scrub({ [key]: "value" })).toEqual({ [key]: FILTERED });
	});

	it("keeps keys that only look similar", () => {
		const data = { tokenizer: "bpe", author: "ada", sessions_count: 3, keyboard: "us" };
		expect(scrub(data)).toEqual(data);
	});

	it("filters nested objects and arrays, also when the value is not a string", () => {
		expect(
			scrub({ a: { b: [{ password: { nested: true } }, { ok: 1 }] }, headers: { Cookie: 5 } }),
		).toEqual({ a: { b: [{ password: FILTERED }, { ok: 1 }] }, headers: { Cookie: FILTERED } });
	});

	it("filters secrets inside string values", () => {
		const out = scrub({
			msg: "auth failed: Bearer abc.def-123_xyz for user",
			jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl",
			card: "paid with 4242 4242 4242 4242 today",
			notCard: "order 1234 5678 9012 3456",
			key: "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----",
			stripe: "sk_live_51Habcdefghijklmnop",
			aws: "AKIAIOSFODNN7EXAMPLE",
			url: "https://ada:hunter2@example.com/path?token=abc&page=2",
		}) as Record<string, string>;
		expect(out.msg).toBe(`auth failed: Bearer ${FILTERED} for user`);
		expect(out.jwt).toBe(FILTERED);
		expect(out.card).toBe(`paid with ${FILTERED} today`);
		expect(out.notCard).toBe("order 1234 5678 9012 3456"); // fails the Luhn check
		expect(out.key).toBe(FILTERED);
		expect(out.stripe).toBe(FILTERED);
		expect(out.aws).toBe(FILTERED);
		expect(out.url).toBe(`https://ada:${FILTERED}@example.com/path?token=${FILTERED}&page=2`);
	});

	it("filters Sentry request data: header pairs and query strings", () => {
		expect(
			scrub({
				headers: [
					["Authorization", "Basic abc"],
					["Accept", "text/html"],
				],
				query_string: "page=2&api_key=abc&q=x",
			}),
		).toEqual({
			headers: [
				["Authorization", FILTERED],
				["Accept", "text/html"],
			],
			query_string: `page=2&api_key=${FILTERED}&q=x`,
		});
	});

	it("does not change the input", () => {
		const input = { password: "x" };
		scrub(input);
		expect(input).toEqual({ password: "x" });
	});
});
