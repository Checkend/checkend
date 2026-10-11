import { Hono } from "hono";
import type { FrontIdentity } from "../core/auth/front-identity.ts";
import type { Session } from "../core/auth/sessions.ts";
import { fixedClock } from "../core/clock.ts";
import { checkHealth } from "../core/health.ts";
import { IngestState } from "../core/ingest/state.ts";
import type { Actor } from "../core/tokens.ts";
import type { Ports } from "../ports/index.ts";
import { apiRoutes } from "./api.ts";
import { baseUrls, crossTenantGuard, isOutsideBase, routePath } from "./base-path.ts";
import { docsRoutes } from "./docs.ts";
import { githubRoutes } from "./github.ts";
import { ingestRoutes } from "./ingest.ts";
import { mcpRoutes } from "./mcp.ts";
import { setupRoutes } from "./setup.ts";
import { coreOnboarding, type Onboarding } from "./ui/onboarding.ts";
import { uiRoutes } from "./ui/routes.ts";
import { isDevRequest } from "./ui/security.ts";

/**
 * Each entry passes its ports as the Hono environment: `app.fetch(request, { ports })`. A hosted
 * install (config.trustedFront) also gets `identity`: the member that the front Worker signed in,
 * an argument of its call (never a header). It is unchecked input until `requireMember` parses it.
 */
export type AppEnv = {
	Bindings: { ports: Ports; identity?: FrontIdentity | null };
	/**
	 * `actor`: who calls /v1 (bearer token) or the UI (a member), set by the auth middleware.
	 * `session` and `form`: UI only, set by `requireMember` and `checkFormCsrf`.
	 */
	Variables: { actor: Actor; session: Session; form: Record<string, string | File> };
};

export interface AppOptions {
	/** In-memory ingest state (caches, D1 write state). One per isolate. */
	state?: IngestState;
	/** The onboarding parts that the web UI calls (setup keys, progress, delete). */
	onboarding?: Onboarding;
}

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
	const state = options.state ?? new IngestState();
	// Under a base path (hosted installs), routes match the path without it.
	const app = new Hono<AppEnv>({ getPath: routePath });

	// A request outside the base path is not for this install: 404 before any route runs.
	const dispatch = app.fetch;
	app.fetch = (request, env, ctx) =>
		isOutsideBase(request, env as AppEnv["Bindings"] | undefined)
			? Response.json({ error: "not_found" }, { status: 404 })
			: dispatch(request, env, ctx);

	// Both do nothing without a base path (self-host).
	app.use("*", crossTenantGuard);
	app.use("*", baseUrls);

	app.get("/health", async (c) => {
		const health = await checkHealth(c.env.ports, state);
		c.header("Cache-Control", "no-store");
		const status = health.status === "ok" ? 200 : 503;
		// Under a base path (hosted installs on a shared origin): no detail that tells one install
		// from another; members see the full state in Settings.
		if (c.env.ports.config.basePath) {
			return c.json({ status: health.status, version: health.version }, status);
		}
		return c.json(health, status);
	});

	// Development only (CHECKEND_DEV and a localhost request): `npm run demo` sends events
	// with an `X-Checkend-Demo-Time` header, so that demo data spreads over past days.
	app.use("/api/*", async (c, next) => {
		const at = c.req.header("x-checkend-demo-time");
		if (at && isDevRequest(c) && Number.isFinite(Date.parse(at))) {
			c.env.ports = { ...c.env.ports, clock: fixedClock(new Date(at)) };
		}
		await next();
	});

	ingestRoutes(app, state);
	githubRoutes(app);
	// Before apiRoutes: /v1/openapi.json is public, so it must answer before the /v1 auth.
	docsRoutes(app);
	// Before apiRoutes: setup keys open only /v1/setup, with their own auth.
	setupRoutes(app, state);
	apiRoutes(app, state);
	mcpRoutes(app);
	uiRoutes(app, state, options.onboarding ?? coreOnboarding(state));

	app.notFound((c) => c.json({ error: "not_found" }, 404));

	return app;
}
