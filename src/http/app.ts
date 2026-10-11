import { Hono } from "hono";
import { checkHealth } from "../core/health.ts";
import { IngestState } from "../core/ingest/state.ts";
import { MAX_SOURCEMAP_BYTES } from "../core/sourcemaps.ts";
import type { Actor } from "../core/tokens.ts";
import type { Ports } from "../ports/index.ts";
import { apiRoutes } from "./api.ts";
import { bodyCap, MAX_JSON_BODY_BYTES } from "./body.ts";
import { docsRoutes } from "./docs.ts";
import { githubRoutes } from "./github.ts";
import { ingestRoutes } from "./ingest.ts";
import { mcpRoutes } from "./mcp.ts";
import { setupRoutes } from "./setup.ts";

/** Each entry passes its ports as the Hono environment: `app.fetch(request, { ports })`. */
export type AppEnv = {
	Bindings: { ports: Ports };
	/** `actor`: who calls /v1, set by the auth middleware. */
	Variables: { actor: Actor };
};

export interface AppOptions {
	/** In-memory ingest state (caches, D1 write state). One per isolate. */
	state?: IngestState;
}

export function createApp(options: AppOptions = {}): Hono<AppEnv> {
	const state = options.state ?? new IngestState();
	const app = new Hono<AppEnv>();

	app.get("/health", async (c) => {
		const health = await checkHealth(c.env.ports, state);
		c.header("Cache-Control", "no-store");
		return c.json(health, health.status === "ok" ? 200 : 503);
	});

	ingestRoutes(app, state);
	githubRoutes(app);
	// Before apiRoutes: /v1/openapi.json is public, so it must answer before the /v1 auth.
	docsRoutes(app);
	// Body caps of the routes below (ingest and the GitHub webhook have their own, above).
	const cap = bodyCap((path) =>
		path === "/v1/sourcemaps" ? MAX_SOURCEMAP_BYTES : MAX_JSON_BODY_BYTES,
	);
	app.use("/v1/*", cap);
	app.use("/mcp", cap);
	// Before apiRoutes: setup keys open only /v1/setup, with their own auth.
	setupRoutes(app, state);
	apiRoutes(app, state);
	mcpRoutes(app);

	app.notFound((c) => c.json({ error: "not_found" }, 404));

	return app;
}
