import type { Hono } from "hono";
import { handleGithubEvent, MAX_WEBHOOK_BYTES, verifyGithubSignature } from "../core/github.ts";
import type { AppEnv } from "./app.ts";

/**
 * POST /hooks/github: GitHub webhook deliveries. Outside /v1: GitHub signs the body with the
 * webhook secret; there is no bearer token. Off (404) without GITHUB_WEBHOOK_SECRET.
 */
export function githubRoutes(app: Hono<AppEnv>): void {
	app.post("/hooks/github", async (c) => {
		const secret = c.env.ports.config.githubWebhookSecret;
		if (!secret) return c.json({ error: "not_found" }, 404);
		const length = Number(c.req.header("content-length") ?? 0);
		if (length > MAX_WEBHOOK_BYTES) return c.json({ error: "payload_too_large" }, 413);
		const body = new Uint8Array(await c.req.arrayBuffer());
		if (body.byteLength > MAX_WEBHOOK_BYTES) return c.json({ error: "payload_too_large" }, 413);
		if (!(await verifyGithubSignature(secret, body, c.req.header("x-hub-signature-256") ?? null))) {
			return c.json({ error: "invalid_signature" }, 401);
		}
		let payload: unknown;
		try {
			payload = JSON.parse(new TextDecoder().decode(body));
		} catch {
			return c.json({ error: "invalid_payload", message: "The body is not JSON." }, 400);
		}
		const result = await handleGithubEvent(
			c.env.ports,
			(c.req.header("x-github-event") ?? "").slice(0, 100),
			(c.req.header("x-github-delivery") ?? "").slice(0, 100),
			payload,
		);
		return c.json(result, "error" in result ? 400 : 200);
	});
}
