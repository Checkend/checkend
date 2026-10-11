import { describe, expect, it } from "vitest";
import { uiApp } from "../../support/ui.ts";

/** A chunked body (no Content-Length) of `total` bytes; `pulled()` says how much was read. */
function chunked(total: number) {
	let pulled = 0;
	const chunk = new Uint8Array(256 * 1024).fill(32);
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (pulled >= total) return controller.close();
			pulled += chunk.byteLength;
			controller.enqueue(chunk);
		},
	});
	return { body, pulled: () => pulled };
}

const MB = 1024 * 1024;

describe("body caps on the web UI", () => {
	it.each(["/login/options", "/login/verify", "/setup/options", "/setup/verify"])(
		"%s (no sign-in) stops reading a chunked body at 1 MB (413)",
		async (path) => {
			const ui = await uiApp();
			const stream = chunked(64 * MB);
			const response = await ui.request(path, {
				method: "POST",
				headers: { origin: ui.origin, "content-type": "application/json" },
				body: stream.body,
				duplex: "half",
			} as RequestInit);
			expect(response.status).toBe(413);
			expect(stream.pulled()).toBeLessThan(2 * MB);
		},
	);

	it.each(["/apps/setup-key", "/apps", "/logout"])(
		"%s (a form) stops reading a chunked body at 1 MB (413)",
		async (path) => {
			const ui = await uiApp();
			const { token } = await ui.signIn();
			const stream = chunked(64 * MB);
			const response = await ui.request(path, {
				method: "POST",
				session: token,
				headers: { origin: ui.origin, "content-type": "application/x-www-form-urlencoded" },
				body: stream.body,
				duplex: "half",
			} as RequestInit);
			expect(response.status).toBe(413);
			expect(stream.pulled()).toBeLessThan(2 * MB);
		},
	);

	it("reads no body of a form without a session", async () => {
		const ui = await uiApp();
		const stream = chunked(64 * MB);
		const response = await ui.request("/apps", {
			method: "POST",
			headers: { origin: ui.origin, "content-type": "application/x-www-form-urlencoded" },
			body: stream.body,
			duplex: "half",
		} as RequestInit);
		expect(response.status).toBe(303);
		expect(stream.pulled()).toBeLessThan(MB);
	});

	it("still takes a normal JSON body and a normal form", async () => {
		const ui = await uiApp();
		expect((await ui.json("/login/options", {})).status).toBe(200);
		const { token, csrf } = await ui.signIn();
		const created = await ui.form("/apps", { _csrf: csrf, name: "Shop" }, token);
		expect(created.status).toBe(303);
	});
});
