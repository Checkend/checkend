import { describe, expect, it } from "vitest";
import type { HttpClient } from "../../src/ports/http.ts";

/**
 * The behaviour every HttpClient adapter must have. `base` is the URL of a test server that
 * echoes POST bodies as {method, body} with status 201 and an x-echo header (the x-test request
 * header), and answers /redirect with 302 (see test/node/node-adapters.test.ts).
 */
export function httpClientContract(
	adapterName: string,
	client: HttpClient,
	base: () => string,
): void {
	describe(`HttpClient contract: ${adapterName}`, () => {
		it("sends the method, headers and body, and returns the status, headers and body", async () => {
			const response = await client.send(`${base()}/hook`, {
				method: "POST",
				headers: { "content-type": "application/json", "x-test": "yes" },
				body: '{"a":1}',
			});
			expect(response.status).toBe(201);
			expect(response.headers.get("x-echo")).toBe("yes");
			expect(await response.json()).toEqual({ method: "POST", body: '{"a":1}' });
		});

		it("does not follow redirects", async () => {
			const response = await client.send(`${base()}/redirect`, {
				method: "POST",
				body: "x",
				redirect: "manual",
			});
			expect(response.status).toBe(302);
		});
	});
}
