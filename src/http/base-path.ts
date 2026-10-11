import type { Context, MiddlewareHandler } from "hono";
import { getPath } from "hono/utils/url";
import type { AppEnv } from "./app.ts";
import { publicOrigin } from "./origin.ts";

/**
 * The base path of an install: a hosted install lives at https://hosted.example/<id>/, and
 * all hosted installs share that one origin. Every URL that the install makes goes through this
 * file: HTML links, forms and assets (`baseUrls`), redirects (`baseUrls`), and the absolute URLs
 * of JSON and text (`publicBase`: DSNs, recipes, llms.txt, skill.md, OpenAPI, MCP, prompts).
 * Routes stay at the root inside the app: Hono matches the path without the base path. Without a
 * base path (self-host), nothing here changes a request or a response.
 */

const SEGMENT = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_SEGMENTS = 4;

/** A base path: "" (the root) or "/a/b": lower case, digits and "-". Throws on anything else. */
export function parseBasePath(value: string): string {
	if (value === "") return "";
	const path = value.endsWith("/") ? value.slice(0, -1) : value;
	const segments = path.split("/");
	if (
		!path.startsWith("/") ||
		segments.length < 2 ||
		segments.length > MAX_SEGMENTS + 1 ||
		!segments.slice(1).every((segment) => SEGMENT.test(segment))
	) {
		throw new Error(`checkend: not a valid base path: ${JSON.stringify(value)}`);
	}
	return path;
}

export const basePathOf = (c: Context<AppEnv>): string => c.env.ports.config.basePath ?? "";

/** The public URL of this install, without a trailing slash: origin plus base path. */
export const publicBase = (c: Context<AppEnv>): string => publicOrigin(c) + basePathOf(c);

/** An app path ("/issues") as a path under the base path. Other values do not change. */
export function withBase(base: string, path: string): string {
	return base && path.startsWith("/") && !path.startsWith("//") ? `${base}${path}` : path;
}

/** The app path of a request path: without the base path, or null when it is outside it. */
export function appPathOf(base: string, path: string): string | null {
	if (!base) return path;
	if (path === base) return "/";
	return path.startsWith(`${base}/`) ? path.slice(base.length) : null;
}

/** For `new Hono({ getPath })`: routes match the path without the base path. */
export function routePath(request: Request, options?: { env?: unknown }): string {
	const path = getPath(request);
	const base = (options?.env as AppEnv["Bindings"] | undefined)?.ports?.config.basePath ?? "";
	return appPathOf(base, path) ?? path;
}

/** True when a request is outside the base path of the install in `env`. */
export function isOutsideBase(request: Request, env: AppEnv["Bindings"] | undefined): boolean {
	const base = env?.ports?.config.basePath ?? "";
	return base !== "" && appPathOf(base, getPath(request)) === null;
}

/** Root-relative URLs in HTML attributes; quoted values only (`h` always writes them so). */
const HTML_URL = /(\s(?:href|src|action|formaction)=")\/(?!\/)/g;

/**
 * Puts the base path into the URLs of a response: the Location header and the root-relative
 * attributes of HTML. Event data in HTML is escaped (`"` is `&quot;`), so only the attributes of
 * our own templates match.
 */
export const baseUrls: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	const base = basePathOf(c);
	if (!base) return;
	const location = c.res.headers.get("location");
	if (location) c.res.headers.set("location", withBase(base, location));
	if ((c.res.headers.get("content-type") ?? "").startsWith("text/html")) {
		const html = await c.res.text();
		const response = new Response(html.replace(HTML_URL, `$1${base}/`), c.res);
		response.headers.delete("content-length");
		c.res = undefined;
		c.res = response;
	}
};

// --- cross-tenant request guard -------------------------------------------------------------

const under = (referer: string, origin: string, base: string): boolean => {
	let url: URL;
	try {
		url = new URL(referer);
	} catch {
		return false;
	}
	return url.origin === origin && (url.pathname === base || url.pathname.startsWith(`${base}/`));
};

/**
 * Hosted installs share one origin, so a page of install A can send requests to /<b>/… and the
 * browser adds what it has for the origin. This guard refuses a request from a page of this
 * origin (or its site) that is not a top-level navigation and whose Referer is not under this
 * install. Navigations (links) stay allowed, as do other sites (a browser SDK that sends errors),
 * clients without a browser (no Sec-Fetch headers, no Referer), and a bearer call that has no
 * cookie and no member identity. The front Worker applies the same guard.
 *
 * It is defence in depth, not a boundary against script in one of our pages: a script can set a
 * same-origin Referer (fetch `referrer`). Event data never runs as script (escaping, strict CSP).
 */
export function isCrossTenant(
	headers: { get(name: string): string | null | undefined },
	origin: string,
	base: string,
	ambient: boolean,
): boolean {
	const site = headers.get("sec-fetch-site") ?? null;
	const mode = headers.get("sec-fetch-mode") ?? null;
	const dest = headers.get("sec-fetch-dest") ?? null;
	const referer = headers.get("referer") ?? null;
	const fromThisSite =
		site !== null
			? site === "same-origin" || site === "same-site"
			: referer !== null && URL.canParse(referer) && new URL(referer).origin === origin;
	if (!fromThisSite) return false;
	if (mode === "navigate" && (dest === "document" || dest === null)) return false;
	const bearer = (headers.get("authorization") ?? "").toLowerCase().startsWith("bearer ");
	if (bearer && !ambient) return false;
	return referer === null || !under(referer, origin, base);
}

export const crossTenantGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
	const base = basePathOf(c);
	if (!base) return next();
	const ambient = c.req.header("cookie") !== undefined || c.env.identity != null;
	if (isCrossTenant(c.req.raw.headers, publicOrigin(c), base, ambient)) {
		return c.json({ error: "forbidden" }, 403);
	}
	return next();
};
