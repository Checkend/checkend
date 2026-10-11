import type { Context } from "hono";
import type { AppEnv } from "./app.ts";

/**
 * The origin of this install: PUBLIC_URL when it is set, else the origin of the request URL.
 * Every URL that Checkend shows or returns, the passkey relying party and the CSRF origin check
 * use it. Behind a proxy that forwards any Host, set PUBLIC_URL.
 */
export const publicOrigin = (c: Context<AppEnv>): string =>
	c.env.ports.config.publicUrl ?? new URL(c.req.url).origin;
