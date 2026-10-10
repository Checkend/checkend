import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "../../../src/http/ui/assets/client.ts";

const CODE = "Zm9vYmFyLXNldHVwLWNvZGUtMDEyMzQ1Njc4OWFiY2RlZg";
const bytes = (text: string) => new TextEncoder().encode(text).buffer;

/** Runs the client script on a fake setup page and returns what it did. */
function setupPage(hash: string) {
	class HTMLFormElement {}
	class Element {}
	const listeners: Record<string, (event: unknown) => void> = {};
	const location = { hash, pathname: "/setup", search: "", assign: () => {} };
	const replaced: string[] = [];
	const requests: { url: string; body: Record<string, unknown> }[] = [];
	const status = { textContent: "" };
	const notice = { hidden: true };
	const button = { disabled: false };
	const form = Object.assign(Object.create(HTMLFormElement.prototype), {
		hidden: true,
		hasAttribute: (name: string) => name === "data-passkey-setup" || name === "data-needs-code",
		querySelector: () => button,
		elements: { namedItem: () => ({ value: "Simon" }) },
	});
	const answers: Record<string, unknown> = {
		"/setup/options": {
			rp: { name: "Checkend", id: "checkend.test" },
			user: { id: "dXNlcg", name: "Simon", displayName: "Simon" },
			challenge: "Y2hhbGxlbmdl",
			pubKeyCredParams: [{ type: "public-key", alg: -7 }],
		},
		"/setup/verify": { redirect: "/projects" },
	};
	const context = {
		location,
		history: {
			replaceState: (_state: unknown, _title: string, url: string) => replaced.push(url),
		},
		document: {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners[type] = listener;
			},
			querySelector: (selector: string) => (selector.includes("data-passkey-setup") ? form : null),
			querySelectorAll: (selector: string) =>
				selector === "[data-js-only]"
					? [form]
					: selector === "[data-setup-missing]"
						? [notice]
						: [],
			getElementById: () => status,
		},
		navigator: {
			credentials: {
				create: async () => ({
					id: "cred",
					rawId: bytes("cred"),
					type: "public-key",
					response: {
						clientDataJSON: bytes("{}"),
						attestationObject: bytes("att"),
						getTransports: () => ["internal"],
					},
					getClientExtensionResults: () => ({}),
				}),
			},
		},
		fetch: async (url: string, init: { body: string }) => {
			requests.push({ url, body: JSON.parse(init.body) });
			return { ok: true, status: 200, json: async () => answers[url] };
		},
		HTMLFormElement,
		Element,
		atob,
		btoa,
		setTimeout,
	};
	runInNewContext(CLIENT_SCRIPT, {
		...context,
		window: {
			...context,
			PublicKeyCredential: () => {},
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners[`window:${type}`] = listener;
			},
		},
	});
	const submit = async () => {
		listeners.submit?.({ target: form, preventDefault: () => {} });
		for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
	};
	/** The person pastes the link into the open tab: only the fragment changes, no reload. */
	const openLink = (newHash: string) => {
		location.hash = newHash;
		listeners["window:hashchange"]?.({});
	};
	return { form, notice, replaced, requests, submit, openLink };
}

describe("client script: the setup link", () => {
	it("removes the code from the address bar, and sends it in the body only", async () => {
		const page = setupPage(`#${CODE}`);
		expect(page.replaced).toEqual(["/setup"]);
		expect(page.form.hidden).toBe(false);
		await page.submit();
		expect(page.requests.map((r) => r.url)).toEqual(["/setup/options", "/setup/verify"]);
		for (const request of page.requests) {
			expect(request.url).not.toContain(CODE);
			expect(request.body.code).toBe(CODE);
			expect(request.body).not.toHaveProperty("token");
		}
	});

	it("shows the notice instead of the form when the link has no code", () => {
		const page = setupPage("");
		expect(page.replaced).toEqual([]);
		expect(page.form.hidden).toBe(true);
		expect(page.notice.hidden).toBe(false);
	});

	it("reads a link pasted into the open setup page (only the fragment changes)", async () => {
		const page = setupPage("");
		page.openLink(`#${CODE}`);
		expect(page.replaced).toEqual(["/setup"]);
		expect(page.form.hidden).toBe(false);
		expect(page.notice.hidden).toBe(true);
		await page.submit();
		expect(page.requests[0]?.body.code).toBe(CODE);
	});
});
