import type { Context, Hono, MiddlewareHandler } from "hono";
import * as v from "valibot";
import { IdParam } from "../core/issues.ts";
import {
	authenticateSetupKey,
	createSetupKey,
	listSetupKeys,
	revokeSetupKey,
} from "../core/setup-keys.ts";
import { authenticate, hasScope } from "../core/tokens.ts";
import type { AppEnv } from "./app.ts";

const invalid = (c: Context, issues: v.BaseIssue<unknown>[]) =>
	c.json(
		{
			error: "invalid_request",
			details: issues.map((issue) => ({ path: v.getDotPath(issue), message: issue.message })),
		},
		400,
	);

/** /v1/setup: a setup key (cks_...), or a normal token. A setup key opens only these routes. */
const requireSetupActor: MiddlewareHandler<AppEnv> = async (c, next) => {
	const authorization = c.req.header("authorization") ?? null;
	const actor =
		(await authenticateSetupKey(c.env.ports, authorization)) ??
		(await authenticate(c.env.ports, authorization));
	if (!actor) {
		c.header("WWW-Authenticate", "Bearer");
		return c.json({ error: "unauthorized" }, 401);
	}
	c.set("actor", actor);
	c.header("Cache-Control", "no-store");
	await next();
};

const needAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
	const actor = c.get("actor");
	if (actor.type === "setup_key" || !hasScope(actor, "admin")) {
		return c.json({ error: "forbidden", required_scope: "admin" }, 403);
	}
	await next();
};

/** The onboarding routes (D20). Registered before apiRoutes, so the /v1 auth does not run. */
export function setupRoutes(app: Hono<AppEnv>): void {
	app.use("/v1/setup/*", requireSetupActor);

	app.post("/v1/setup/keys", needAdmin, async (c) =>
		c.json({ data: await createSetupKey(c.env.ports, c.get("actor")) }, 201),
	);

	app.get("/v1/setup/keys", needAdmin, async (c) =>
		c.json({ data: await listSetupKeys(c.env.ports.db, c.env.ports.clock.now()) }),
	);

	app.delete("/v1/setup/keys/:id", needAdmin, async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const revoked = await revokeSetupKey(c.env.ports, c.get("actor"), params.output.id);
		return revoked ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	});
}
