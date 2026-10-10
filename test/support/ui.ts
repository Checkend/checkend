import { createDevSession, getSession } from "../../src/core/auth/sessions.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import type { Config } from "../../src/ports/config.ts";
import { testPorts } from "./node-ports.ts";

export const UI_ADMIN_TOKEN = "ui-admin-token-0123456789";
export const UI_ORIGIN = "https://checkend.test";
export const SESSION_COOKIE = "__Host-checkend_session";

/** The app with a test database, plus helpers to call UI routes as a browser would. */
export async function uiApp(config: Partial<Config> = {}, origin = UI_ORIGIN) {
	const t = await testPorts({ config: { adminToken: UI_ADMIN_TOKEN, ...config } });
	const app = createApp({ state: new IngestState() });

	const request = (path: string, init: RequestInit & { session?: string } = {}) => {
		const { session, ...rest } = init;
		const headers = new Headers(rest.headers);
		if (session) headers.set("cookie", `${SESSION_COOKIE}=${session}`);
		return app.request(new URL(path, origin).toString(), { ...rest, headers }, { ports: t.ports });
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
