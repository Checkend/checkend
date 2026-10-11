import { Hono } from "hono";
import type { Session } from "../core/auth/sessions.ts";
import { fixedClock } from "../core/clock.ts";
import { checkHealth } from "../core/health.ts";
import { IngestState } from "../core/ingest/state.ts";
import type { Actor } from "../core/tokens.ts";
import type { Ports } from "../ports/index.ts";
import { apiRoutes } from "./api.ts";
import { docsRoutes } from "./docs.ts";
import { githubRoutes } from "./github.ts";
import { ingestRoutes } from "./ingest.ts";
import { mcpRoutes } from "./mcp.ts";
import { setupRoutes } from "./setup.ts";
import { coreOnboarding, type Onboarding } from "./ui/onboarding.ts";
import { uiRoutes } from "./ui/routes.ts";
import { isDevRequest } from "./ui/security.ts";

/** Each entry passes its ports as the Hono environment: `app.fetch(request, { ports })`. */
export type AppEnv = {
	Bindings: { ports: Ports };
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
	const app = new Hono<AppEnv>();

	app.get("/health", async (c) => {
		const health = await checkHealth(c.env.ports, state);
		c.header("Cache-Control", "no-store");
		return c.json(health, health.status === "ok" ? 200 : 503);
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
