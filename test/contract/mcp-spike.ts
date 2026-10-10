import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

/**
 * Spike: the MCP SDK v2 Web Standard Streamable HTTP transport, stateless, behind /mcp.
 * The same test runs in Node (app.request) and in workerd (the Worker entry).
 */
export function mcpTransportSpike(
	runtime: string,
	fetchFn: (request: Request) => Promise<Response>,
): void {
	describe(`MCP transport spike: ${runtime}`, () => {
		const connect = async () => {
			const client = new Client({ name: "spike-test", version: "1.0.0" });
			const transport = new StreamableHTTPClientTransport(new URL("https://checkend.test/mcp"), {
				fetch: (input, init) => fetchFn(new Request(input, init)),
			});
			await client.connect(transport);
			return client;
		};

		it("lists the tools and calls one, with a Valibot input schema", async () => {
			const client = await connect();
			const { tools } = await client.listTools();
			const ping = tools.find((t) => t.name === "ping");
			expect(ping?.inputSchema).toMatchObject({
				type: "object",
				properties: { name: { type: "string" } },
			});
			const result = await client.callTool({ name: "ping", arguments: { name: "agent" } });
			expect(result.content).toEqual([{ type: "text", text: "pong agent" }]);
			await client.close();
		});

		it("rejects invalid tool input", async () => {
			const client = await connect();
			const result = await client.callTool({ name: "ping", arguments: { name: 42 } });
			expect(result.isError).toBe(true);
			await client.close();
		});
	});
}
