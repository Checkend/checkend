import type { FrontIdentity } from "../../src/core/auth/front-identity.ts";
import { storedSetupCode } from "../../src/core/auth/passkeys.ts";
import { createDevSession, getSession } from "../../src/core/auth/sessions.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import type { Onboarding } from "../../src/http/ui/onboarding.ts";
import type { Config } from "../../src/ports/config.ts";
import type { Ports } from "../../src/ports/index.ts";
import { testPorts } from "./node-ports.ts";

export const UI_ADMIN_TOKEN = "ui-admin-token-0123456789";
export const UI_SETUP_CODE = "ui-setup-code-0123456789abcdefghijklmnopq";
export const UI_ORIGIN = "https://checkend.test";
export const SESSION_COOKIE = "__Host-checkend_session";

/** The app with a test database, plus helpers to call UI routes as a browser would. */
export async function uiApp(
	config: Partial<Config> = {},
	origin = UI_ORIGIN,
	overrides: Partial<Omit<Ports, "config">> = {},
	options: { onboarding?: Onboarding } = {},
) {
	const t = await testPorts({
		...overrides,
		config: {
			adminToken: UI_ADMIN_TOKEN,
			// Made at the start of the test clock: valid for 24 hours.
			setupCode: storedSetupCode(UI_SETUP_CODE, new Date("2026-10-10T12:00:00Z")),
			...config,
		},
	});
	const app = createApp({ state: new IngestState(), ...options });

	/** `identity`: the member identity that a front Worker passes with its call (hosted installs). */
	const request = (
		path: string,
		init: RequestInit & { session?: string; identity?: FrontIdentity } = {},
	) => {
		const { session, identity, ...rest } = init;
		const headers = new Headers(rest.headers);
		if (session) headers.set("cookie", `${SESSION_COOKIE}=${session}`);
		const env = identity ? { ports: t.ports, identity } : { ports: t.ports };
		return app.request(new URL(path, origin).toString(), { ...rest, headers }, env);
	};

	/** A signed-in browser (development session; the passkey flow has its own tests). */
	const signIn = async () => {
		const created = await createDevSession(t.ports);
		const session = await getSession(t.ports, created.token);
		if (!session) throw new Error("no session");
		return { token: created.token, csrf: session.csrfToken };
	};

	/** A same-origin form post, like a browser sends it. */
	const form = (
		path: string,
		fields: Record<string, string>,
		session?: string,
		headers: Record<string, string> = { origin },
	) =>
		request(path, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
			body: new URLSearchParams(fields).toString(),
			...(session ? { session } : {}),
		});

	/** A same-origin JSON post, like the passkey script sends it. */
	const json = (path: string, body: unknown, headers: Record<string, string> = { origin }) =>
		request(path, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(body),
		});

	return { ...t, app, origin, request, signIn, form, json };
}

/** The session ID from a Set-Cookie header. */
export function sessionFrom(response: Response): string | null {
	const cookie = response.headers.get("set-cookie") ?? "";
	return new RegExp(`${SESSION_COOKIE}=([^;]*)`).exec(cookie)?.[1] || null;
}
