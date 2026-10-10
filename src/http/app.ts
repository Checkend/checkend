import { Hono } from "hono";
import { checkHealth } from "../core/health.ts";
import type { Ports } from "../ports/index.ts";

/** Each entry passes its ports as the Hono environment: `app.fetch(request, { ports })`. */
export type AppEnv = { Bindings: { ports: Ports } };

export function createApp(): Hono<AppEnv> {
	const app = new Hono<AppEnv>();

	app.get("/health", async (c) => {
		const health = await checkHealth(c.env.ports);
		c.header("Cache-Control", "no-store");
		return c.json(health, health.status === "ok" ? 200 : 503);
	});

	app.notFound((c) => c.json({ error: "not_found" }, 404));

	return app;
}
