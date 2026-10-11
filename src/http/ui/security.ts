import type { Context, MiddlewareHandler } from "hono";
import { frontSession, parseFrontIdentity } from "../../core/auth/front-identity.ts";
import { isSetupOpen } from "../../core/auth/passkeys.ts";
import { getSession, type Session } from "../../core/auth/sessions.ts";
import type { Scope } from "../../core/tokens.ts";
import type { AppEnv } from "../app.ts";
import { bodyCap, MAX_JSON_BODY_BYTES } from "../body.ts";
import { publicOrigin } from "../origin.ts";

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
	// Browsers ignore it on http://localhost; on a custom domain it keeps the UI on HTTPS.
	"strict-transport-security": "max-age=31536000",
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
	let session: Session | null;
	// Self-host: every member is an admin. Hosted: an owner is; a member is not (MEMBER_SCOPES).
	let scopes: Scope[] = ["admin"];
	if (c.env.ports.config.trustedFront) {
		// A hosted install: the member comes only from the front Worker's call; cookies are ignored.
		const identity = parseFrontIdentity(c.env.identity);
		if (!identity) return c.json({ error: "not_found" }, 404);
		session = await frontSession(c.env.ports, identity);
		if (identity.role !== "owner") scopes = [...MEMBER_SCOPES];
	} else {
		const token = sessionToken(c);
		session = token ? await getSession(c.env.ports, token) : null;
	}
	if (!session) {
		return c.redirect((await isSetupOpen(c.env.ports.db)) ? "/setup" : "/login", 303);
	}
	c.set("session", session);
	c.set("actor", {
		type: "member",
		id: session.memberId,
		name: session.memberName,
		scopes,
	});
	await next();
};

/**
 * The scopes of a member that is not an owner (hosted installs): the issues and the setup of apps,
 * but no admin actions. In the UI, only an owner can delete an app; admin tokens and approvals are
 * in the bearer API only, which a member identity never reaches.
 */
export const MEMBER_SCOPES: readonly Scope[] = ["issues:read", "issues:write", "releases:write"];

/**
 * For the install's own setup, sign-in and sign-out: a 404 in a hosted install (trusted front
 * identity), where the front Worker does all of it.
 */
export const ownSignIn: MiddlewareHandler<AppEnv> = async (c, next) => {
	if (c.env.ports.config.trustedFront) return c.json({ error: "not_found" }, 404);
	await next();
};

// --- CSRF -------------------------------------------------------------------------------

/**
 * The body cap of every UI POST (1 MB, also for a chunked body; 413 above it). The CSRF checks
 * run it: the passkey routes before sign-in, the forms after `requireMember`.
 */
const uiBodyCap = bodyCap(() => MAX_JSON_BODY_BYTES);

/**
 * A state-changing request must come from this origin: the Origin header (all current
 * browsers send it on POST) must match, and Sec-Fetch-Site, when sent, must be same-origin.
 */
function sameOrigin(c: Context<AppEnv>): boolean {
	const origin = c.req.header("origin");
	const site = c.req.header("sec-fetch-site");
	if (site !== undefined && site !== "same-origin") return false;
	return origin === publicOrigin(c);
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
	return uiBodyCap(c, async () => {
		const form = await c.req.parseBody();
		const given = typeof form._csrf === "string" ? form._csrf : "";
		if (!sameOrigin(c) || !constantTimeEqual(given, c.get("session").csrfToken)) {
			c.res = c.text(
				"This form expired or came from another site. Reload the page and try again.",
				403,
			);
			return;
		}
		c.set("form", form as Record<string, string | File>);
		await next();
	});
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
	return uiBodyCap(c, next);
};

// --- development guard ------------------------------------------------------------------

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "forwarded"];

/**
 * Development features: only with the development flag AND a request to localhost that did
 * not come through a proxy or tunnel (a tunnel can rewrite the Host header to localhost). The
 * client address comes from the clientIp port: CF-Connecting-IP on Workers (absent in local
 * `wrangler dev`), the socket address on Node, where a client can send any header.
 */
export function isDevRequest(c: Context<AppEnv>): boolean {
	if (!c.env.ports.config.devMode) return false;
	if (!LOCAL_HOSTS.has(new URL(c.req.url).hostname)) return false;
	if (PROXY_HEADERS.some((name) => c.req.header(name) !== undefined)) return false;
	const ip = c.env.ports.clientIp(c.req.raw);
	return ip === "unknown" || LOOPBACK_IPS.has(ip);
}

/**
 * The rate-limit key of a client IP: the address for IPv4, the /64 network for IPv6 (one
 * network can use many addresses).
 */
export function clientKey(ip: string | undefined): string {
	if (!ip) return "unknown";
	if (!ip.includes(":")) return ip;
	if (ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1); // IPv4-mapped
	const [head = "", tail] = ip.toLowerCase().split("::");
	const left = head ? head.split(":") : [];
	const right = tail ? tail.split(":") : [];
	const groups = [
		...left,
		...Array(Math.max(0, 8 - left.length - right.length)).fill("0"),
		...right,
	];
	const network = groups.slice(0, 4).map((g) => Number.parseInt(g || "0", 16).toString(16));
	return `${network.join(":")}::/64`;
}

/** The client for the sign-in rate limit, from the clientIp port (never from a header here). */
export const clientIp = (c: Context<AppEnv>): string => clientKey(c.env.ports.clientIp(c.req.raw));

export type { Session };
