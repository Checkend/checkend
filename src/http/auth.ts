import type { MiddlewareHandler } from "hono";
import { authenticate, hasScope, type Scope } from "../core/tokens.ts";
import type { AppEnv } from "./app.ts";

/**
 * Needs `Authorization: Bearer <token>`: a scoped token, or the bootstrap ADMIN_TOKEN secret.
 * Without a valid token: 401, before the route runs. Used by /v1 and /mcp.
 */
export const requireActor: MiddlewareHandler<AppEnv> = async (c, next) => {
	const actor = await authenticate(c.env.ports, c.req.header("authorization") ?? null);
	if (!actor) {
		c.header("WWW-Authenticate", "Bearer");
		return c.json({ error: "unauthorized" }, 401);
	}
	c.set("actor", actor);
	c.header("Cache-Control", "no-store");
	await next();
};

/** A route needs this scope; `admin` includes all scopes. */
export const need =
	(scope: Scope): MiddlewareHandler<AppEnv> =>
	async (c, next) => {
		if (!hasScope(c.get("actor"), scope)) {
			return c.json({ error: "forbidden", required_scope: scope }, 403);
		}
		await next();
	};
