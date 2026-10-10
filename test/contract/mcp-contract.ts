import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

export interface McpTestTokens {
	/** A token with issues:read. */
	reader: string;
	/** A token without issues:read (releases:write only). */
	noRead: string;
	/** The bootstrap ADMIN_TOKEN. */
	admin: string;
}

/**
 * The MCP endpoint (SDK v2 Web Standard Streamable HTTP transport, stateless) and its bearer
 * auth. The same tests run in Node (app.request) and in workerd (the Worker entry).
 */
export function mcpContract(
	runtime: string,
	fetchFn: (request: Request) => Promise<Response>,
	tokens: () => Promise<McpTestTokens>,
): void {
	describe(`MCP endpoint: ${runtime}`, () => {
		const connect = async (token: string) => {
			const client = new Client({ name: "contract-test", version: "1.0.0" });
			const transport = new StreamableHTTPClientTransport(new URL("https://checkend.test/mcp"), {
				fetch: (input, init) => {
					const request = new Request(input, init);
					request.headers.set("authorization", `Bearer ${token}`);
					return fetchFn(request);
				},
			});
			await client.connect(transport);
			return client;
		};

		const initialize = (headers: Record<string, string>) =>
			fetchFn(
				new Request("https://checkend.test/mcp", {
					method: "POST",
					headers: {
						"content-type": "application/json",
						accept: "application/json, text/event-stream",
						...headers,
					},
					body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
				}),
			);

		it("rejects a request without a token with 401, before the MCP transport runs", async () => {
			const response = await initialize({});
			expect(response.status).toBe(401);
			expect(response.headers.get("www-authenticate")).toBe("Bearer");
			expect(await response.json()).toEqual({ error: "unauthorized" });
		});

		it("rejects a wrong token with 401", async () => {
			const response = await initialize({ authorization: "Bearer ck_not-a-real-token" });
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "unauthorized" });
		});

		it("rejects a token without issues:read with 403", async () => {
			const { noRead } = await tokens();
			const response = await initialize({ authorization: `Bearer ${noRead}` });
			expect(response.status).toBe(403);
			expect(await response.json()).toEqual({ error: "forbidden", required_scope: "issues:read" });
		});

		it("lists the tools and calls one with an issues:read token and with the admin token", async () => {
			const { reader, admin } = await tokens();
			for (const token of [reader, admin]) {
				const client = await connect(token);
				const { tools } = await client.listTools();
				expect(tools.length).toBeGreaterThan(0);
				const result = await client.callTool({ name: "ping", arguments: { name: "agent" } });
				expect(result.content).toEqual([{ type: "text", text: "pong agent" }]);
				await client.close();
			}
		});

		it("rejects invalid tool input", async () => {
			const client = await connect((await tokens()).reader);
			const result = await client.callTool({ name: "ping", arguments: { name: 42 } });
			expect(result.isError).toBe(true);
			await client.close();
		});
	});
}
