import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { toStandardJsonSchema } from "@valibot/to-json-schema";
import type { Hono } from "hono";
import * as v from "valibot";
import { VERSION } from "../core/version.ts";
import type { AppEnv } from "./app.ts";
import { need, requireActor } from "./auth.ts";

/**
 * MCP over Streamable HTTP (Web Standard transport, MCP SDK v2). Stateless: one server and
 * one transport per request, so it runs the same in a Worker and on Node. It needs a bearer
 * token with issues:read (or the bootstrap ADMIN_TOKEN).
 */
export function mcpRoutes(app: Hono<AppEnv>): void {
	// Auth runs before the MCP transport: no token, a wrong token, or a missing scope never
	// reaches the server.
	app.all("/mcp", requireActor, need("issues:read"), async (c) => {
		const server = new McpServer({ name: "checkend", version: VERSION });
		server.registerTool(
			"ping",
			{
				description: "Spike: answers pong.",
				inputSchema: toStandardJsonSchema(v.object({ name: v.string() })),
			},
			async ({ name }) => ({ content: [{ type: "text", text: `pong ${name}` }] }),
		);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await server.connect(transport);
		return transport.handleRequest(c.req.raw);
	});
}
