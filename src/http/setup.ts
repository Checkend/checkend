import type { Context, Hono, MiddlewareHandler } from "hono";
import * as v from "valibot";
import type { IngestState } from "../core/ingest/state.ts";
import { IdParam } from "../core/issues.ts";
import {
	AgentTokenBody,
	createAgentToken,
	RegisterAppBody,
	ReportBody,
	registerApp,
	reportSetupStep,
	sendTestEvent,
} from "../core/setup.ts";
import {
	authenticateSetupKey,
	createSetupKey,
	listSetupKeys,
	revokeSetupKey,
} from "../core/setup-keys.ts";
import { onboardingProgress } from "../core/setup-progress.ts";
import { authenticate, hasScope } from "../core/tokens.ts";
import { dsn } from "./api.ts";
import type { AppEnv } from "./app.ts";
import { authenticatedBodyCap } from "./body.ts";
import { publicOrigin } from "./origin.ts";

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

/** The onboarding routes. Registered before apiRoutes, so the /v1 auth does not run. */
export function setupRoutes(app: Hono<AppEnv>, state: IngestState): void {
	app.use("/v1/setup/*", requireSetupActor, authenticatedBodyCap);

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

	app.post("/v1/setup/apps", async (c) => {
		const body = v.safeParse(RegisterAppBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await registerApp(c.env.ports, c.get("actor"), body.output);
		if (!result.ok) {
			return result.error === "limit"
				? c.json({ error: "limit", message: "This setup key registered its maximum of apps." }, 429)
				: c.json({ error: "forbidden", required_scope: "admin" }, 403);
		}
		const { public_key, ...data } = result;
		return c.json(
			{ data: { ...data, dsn: dsn(publicOrigin(c), public_key, result.project.id) } },
			result.created ? 201 : 200,
		);
	});

	app.post("/v1/setup/tokens", async (c) => {
		const body = v.safeParse(AgentTokenBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await createAgentToken(c.env.ports, c.get("actor"), body.output);
		if (result.ok) return c.json({ data: { ...result.record, token: result.token } }, 201);
		if (result.error === "limit")
			return c.json({ error: "limit", message: "This setup key made its maximum of tokens." }, 429);
		return result.error === "forbidden"
			? c.json({ error: "forbidden", required_scope: "admin" }, 403)
			: c.json({ error: "not_found" }, 404);
	});

	app.post("/v1/setup/apps/:project/test-event", async (c) => {
		const result = await sendTestEvent(c.env.ports, state, c.get("actor"), c.req.param("project"));
		if (result.ok) return c.json({ data: { sent: true } }, 202);
		return result.error === "already_sent"
			? c.json({ error: "already_sent", message: "This app already has its test event." }, 409)
			: c.json({ error: "not_found" }, 404);
	});

	app.post("/v1/setup/apps/:project/report", async (c) => {
		const body = v.safeParse(ReportBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await reportSetupStep(
			c.env.ports,
			c.get("actor"),
			c.req.param("project"),
			body.output.step,
		);
		if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
		return result === "ok" ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/setup/progress", async (c) => {
		const actor = c.get("actor");
		if (actor.type !== "setup_key" && !hasScope(actor, "admin")) {
			return c.json({ error: "forbidden", required_scope: "admin" }, 403);
		}
		const progress = await onboardingProgress(
			c.env.ports.db,
			c.env.ports.clock.now(),
			actor.type === "setup_key" && actor.id !== null ? { setupKeyId: actor.id } : {},
		);
		return c.json({ data: progress });
	});
}
