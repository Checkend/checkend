import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { CLIENT_SCRIPT } from "../../../src/http/ui/assets/client.ts";

const CODE = "Zm9vYmFyLXNldHVwLWNvZGUtMDEyMzQ1Njc4OWFiY2RlZg";
const bytes = (text: string) => new TextEncoder().encode(text).buffer;

/** Runs the client script on a fake setup page and returns what it did. */
function setupPage(hash: string, scriptSrc = "https://checkend.test/assets/app.0.js") {
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
		"/setup/verify": { redirect: "/" },
	};
	// Under a base path, the same answers.
	for (const [url, answer] of Object.entries(answers)) answers[`/k7q2x9${url}`] = answer;
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
			currentScript: { src: scriptSrc },
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

describe("client script: a base path", () => {
	it("sends its requests under the base path of its own script URL", async () => {
		const page = setupPage(`#${CODE}`, "https://hosted.test/k7q2x9/assets/app.0.js");
		await page.submit();
		expect(page.requests.map((r) => r.url)).toEqual([
			"/k7q2x9/setup/options",
			"/k7q2x9/setup/verify",
		]);
	});

	it("builds every path from the base path", () => {
		const paths = [...CLIENT_SCRIPT.matchAll(/(.{0,7})["'](\/[a-z][^"']*)["']/g)];
		expect(paths.length).toBeGreaterThan(5);
		expect(paths.filter((m) => m[1] !== "BASE + ").map((m) => m[2])).toEqual([]);
	});
});

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

/** Runs the client script on a fake home page: the prompt box and a copy button. */
function homePage(answer: { status: number; body: Record<string, unknown> }) {
	class HTMLFormElement {}
	class Element {}
	const listeners: Record<string, (event: unknown) => void> = {};
	const requests: { url: string; body: string; accept: string }[] = [];
	const copied: string[] = [];
	const status = { textContent: "" };
	const code = { textContent: "placeholder" };
	const pre = { querySelector: () => code, removeAttribute: () => {} };
	const button = { disabled: false };
	const form = Object.assign(Object.create(HTMLFormElement.prototype), {
		hasAttribute: (name: string) => name === "data-setup-prompt",
		getAttribute: (name: string) => (name === "action" ? "/apps/setup-key" : null),
		querySelector: (selector: string) =>
			selector.includes("_csrf") ? { value: "csrf-token" } : button,
	});
	const copyButton = Object.assign(Object.create(Element.prototype), {
		closest: () => copyButton,
		hasAttribute: (name: string) => name === "data-copy-text",
		getAttribute: (name: string) => (name === "data-copy-text" ? "Prompt for the agent" : null),
		setAttribute: () => {},
		removeAttribute: () => {},
	});
	const context = {
		location: { hash: "", pathname: "/", search: "" },
		history: { replaceState: () => {} },
		document: {
			addEventListener: (type: string, listener: (event: unknown) => void) => {
				listeners[type] = listener;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			getElementById: (id: string) =>
				id === "prompt-status" ? status : id === "setup-prompt" ? pre : { textContent: "" },
		},
		navigator: {
			clipboard: {
				writeText: async (text: string) => {
					copied.push(text);
				},
			},
		},
		fetch: async (url: string, init: { body: string; headers: Record<string, string> }) => {
			requests.push({ url, body: init.body, accept: init.headers.accept ?? "" });
			return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
		},
		HTMLFormElement,
		Element,
		URLSearchParams,
		Date,
		setTimeout,
		clearTimeout,
	};
	runInNewContext(CLIENT_SCRIPT, {
		...context,
		window: { ...context, addEventListener: () => {} },
	});
	const settle = async () => {
		for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
	};
	const submit = async () => {
		listeners.submit?.({ target: form, preventDefault: () => {} });
		await settle();
	};
	const click = async () => {
		listeners.click?.({ target: copyButton });
		await settle();
	};
	return { requests, copied, status, code, button, submit, click };
}

describe("client script: the prompt box", () => {
	it("asks for a new key, shows the prompt, and copies it", async () => {
		const page = homePage({
			status: 200,
			body: {
				prompt: "Set up Checkend … CHECKEND_SETUP_KEY=cks_new",
				expires_at: "2026-10-10T13:00:00Z",
			},
		});
		await page.submit();
		expect(page.requests).toEqual([
			{ url: "/apps/setup-key", body: "_csrf=csrf-token", accept: "application/json" },
		]);
		expect(page.code.textContent).toBe("Set up Checkend … CHECKEND_SETUP_KEY=cks_new");
		expect(page.copied).toEqual(["Set up Checkend … CHECKEND_SETUP_KEY=cks_new"]);
		expect(page.status.textContent).toContain("Copied");
		expect(page.button.disabled).toBe(false);
	});

	it("says so when this install cannot make keys", async () => {
		const page = homePage({ status: 503, body: { error: "unavailable" } });
		await page.submit();
		expect(page.copied).toEqual([]);
		expect(page.status.textContent).toContain("cannot make setup keys");
	});

	it("copies the prompt of an Ask your agent item", async () => {
		const page = homePage({ status: 200, body: {} });
		await page.click();
		expect(page.copied).toEqual(["Prompt for the agent"]);
	});
});
