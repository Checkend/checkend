import type { Context, MiddlewareHandler } from "hono";
import { isSetupOpen } from "../../core/auth/passkeys.ts";
import { getSession, type Session } from "../../core/auth/sessions.ts";
import type { AppEnv } from "../app.ts";

/**
 * Security for the web UI: response headers, the session cookie, CSRF checks and the
 * development guard. The JSON API (/v1) and ingest do not use any of this.
 */

/** No inline script or style, no plugins, no framing; scripts and styles from this origin only. */
export const CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self'",
	"img-src 'self' data:",
	"connect-src 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"base-uri 'none'",
	"require-trusted-types-for 'script'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
	"content-security-policy": CSP,
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "same-origin",
	"cross-origin-opener-policy": "same-origin",
	"permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
	if (!c.res.headers.has("cache-control")) c.res.headers.set("cache-control", "no-store");
};

// --- session cookie ---------------------------------------------------------------------

/** `__Host-`: the browser accepts it only with Secure, Path=/ and no Domain. */
export const SESSION_COOKIE = "__Host-checkend_session";
const COOKIE_ATTRIBUTES = "Path=/; Max-Age=%; HttpOnly; Secure; SameSite=Strict";

export const sessionCookie = (token: string, maxAgeSeconds: number): string =>
	`${SESSION_COOKIE}=${token}; ${COOKIE_ATTRIBUTES.replace("%", String(maxAgeSeconds))}`;

export const clearedSessionCookie = (): string => sessionCookie("", 0);

export function sessionToken(c: Context): string | null {
	const header = c.req.header("cookie") ?? "";
	for (const part of header.split(";")) {
		const [name, ...value] = part.trim().split("=");
		if (name === SESSION_COOKIE) return value.join("=") || null;
	}
	return null;
}

/**
 * Needs a signed-in member. Without one: a redirect to /setup (no member exists yet) or
 * to /login. Sets `session` and `actor` (activity rows show the member).
 */
export const requireMember: MiddlewareHandler<AppEnv> = async (c, next) => {
	const token = sessionToken(c);
	const session = token ? await getSession(c.env.ports, token) : null;
	if (!session) {
		return c.redirect((await isSetupOpen(c.env.ports.db)) ? "/setup" : "/login", 303);
	}
	c.set("session", session);
	c.set("actor", {
		type: "member",
		id: session.memberId,
		name: session.memberName,
		scopes: ["admin"],
	});
	await next();
};

// --- CSRF -------------------------------------------------------------------------------

/**
 * A state-changing request must come from this origin: the Origin header (all current
 * browsers send it on POST) must match, and Sec-Fetch-Site, when sent, must be same-origin.
 */
function sameOrigin(c: Context): boolean {
	const origin = c.req.header("origin");
	const site = c.req.header("sec-fetch-site");
	if (site !== undefined && site !== "same-origin") return false;
	return origin === new URL(c.req.url).origin;
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}

/**
 * For HTML forms of a signed-in member (after `requireMember`): same origin, and the
 * `_csrf` field must match the session's CSRF token. The parsed form is kept in `form`.
 */
export const checkFormCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
	const type = c.req.header("content-type") ?? "";
	if (!type.startsWith("application/x-www-form-urlencoded")) {
		return c.text("Unsupported form encoding.", 415);
	}
	const form = await c.req.parseBody();
	const given = typeof form._csrf === "string" ? form._csrf : "";
	if (!sameOrigin(c) || !constantTimeEqual(given, c.get("session").csrfToken)) {
		return c.text(
			"This form expired or came from another site. Reload the page and try again.",
			403,
		);
	}
	c.set("form", form as Record<string, string | File>);
	await next();
};

/**
 * For the passkey JSON endpoints (before sign-in, so no session token exists): same origin
 * and `Content-Type: application/json`. A cross-site page cannot send that type without a
 * CORS preflight, which this app never allows.
 */
export const checkJsonCsrf: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (!(c.req.header("content-type") ?? "").startsWith("application/json")) {
		return c.json({ error: "unsupported_media_type" }, 415);
	}
	if (!sameOrigin(c)) return c.json({ error: "forbidden" }, 403);
	await next();
};

// --- development guard ------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Development features: only with the development flag AND for a request to localhost. */
export function isDevRequest(c: Context<AppEnv>): boolean {
	return c.env.ports.config.devMode && LOCAL_HOSTS.has(new URL(c.req.url).hostname);
}

/** The client IP for the sign-in rate limit. */
export const clientIp = (c: Context): string => c.req.header("cf-connecting-ip") ?? "unknown";

export type { Session };
