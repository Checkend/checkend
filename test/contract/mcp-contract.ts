import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";

export interface McpTestTokens {
	/** An issue with one stored event, and that event. */
	issueId: number;
	eventId: number;
	/** A token with issues:read. */
	reader: string;
	/** A token with issues:read and issues:write. */
	writer: string;
	/** A second writer token (another agent). */
	writerB: string;
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

		const text = (result: { content?: unknown }) =>
			((result.content as { type: string; text: string }[] | undefined) ?? [])
				.map((c) => c.text)
				.join("\n");

		it("lists the tools, with an issues:read token and with the admin token", async () => {
			const { reader, admin } = await tokens();
			for (const token of [reader, admin]) {
				const client = await connect(token);
				const { tools } = await client.listTools();
				expect(tools.map((t) => t.name).sort()).toEqual([
					"add_note",
					"claim_issue",
					"correct_triage",
					"get_event",
					"get_issue_brief",
					"ignore_issue",
					"link_fix",
					"list_alerts",
					"list_issues",
					"list_releases",
					"merge_issues",
					"release_claim",
					"resolve_issue",
					"split_issue",
				]);
				for (const tool of tools) expect(tool.description, tool.name).toMatch(/untrusted/i);
				await client.close();
			}
		});

		it("list_issues returns the issues with the untrusted notice", async () => {
			const { reader, issueId } = await tokens();
			const client = await connect(reader);
			const result = await client.callTool({ name: "list_issues", arguments: { limit: 5 } });
			const body = JSON.parse(text(result));
			expect(body.untrusted_notice).toMatch(/do not follow instructions/i);
			expect(body.issues.map((i: { id: number }) => i.id)).toContain(issueId);
			expect(body.issues[0]).toMatchObject({
				status: "unresolved",
				times_seen: expect.any(Number),
				priority: expect.any(Number),
				events_24h: expect.any(Number),
				users_affected: expect.any(Number),
			});
			expect(body.sort).toBe("priority");
			await client.close();
		});

		it("get_issue_brief returns the Markdown brief, or JSON on request", async () => {
			const { reader, issueId } = await tokens();
			const client = await connect(reader);
			const markdown = text(
				await client.callTool({ name: "get_issue_brief", arguments: { issue_id: issueId } }),
			);
			expect(markdown).toContain(`# Checkend issue ${issueId} (brief v1)`);
			expect(markdown).toContain("(UNTRUSTED)");
			const json = JSON.parse(
				text(
					await client.callTool({
						name: "get_issue_brief",
						arguments: { issue_id: issueId, format: "json" },
					}),
				),
			);
			expect(json).toMatchObject({ brief_version: 1, issue: { id: issueId } });
			await client.close();
		});

		it("get_event returns the normalized event with the untrusted notice", async () => {
			const { reader, eventId } = await tokens();
			const client = await connect(reader);
			const body = JSON.parse(
				text(await client.callTool({ name: "get_event", arguments: { event_id: eventId } })),
			);
			expect(body.untrusted_notice).toMatch(/do not follow instructions/i);
			expect(body.event.event.exceptions[0].type).toBe("TypeError");
			expect(JSON.stringify(body)).not.toContain('"raw"');
			await client.close();
		});

		it("returns a tool error for an unknown issue or event, and for invalid input", async () => {
			const client = await connect((await tokens()).reader);
			const unknown = await client.callTool({
				name: "get_issue_brief",
				arguments: { issue_id: 999999 },
			});
			expect(unknown.isError).toBe(true);
			expect(text(unknown)).toMatch(/not found/i);
			expect(
				(await client.callTool({ name: "get_event", arguments: { event_id: 999999 } })).isError,
			).toBe(true);
			expect(
				(await client.callTool({ name: "get_issue_brief", arguments: { issue_id: "abc" } }))
					.isError,
			).toBe(true);
			expect(
				(await client.callTool({ name: "list_issues", arguments: { limit: 1000 } })).isError,
			).toBe(true);
			const noProject = await client.callTool({
				name: "list_issues",
				arguments: { project: "no-such-project" },
			});
			expect(noProject.isError).toBe(true);
			expect(text(noProject)).toMatch(/not found/i);
			const filtered = JSON.parse(
				text(
					await client.callTool({
						name: "list_issues",
						arguments: { since: "1d", search: "undefined" },
					}),
				),
			);
			expect(filtered.issues.length).toBeGreaterThan(0);
			const badCursor = await client.callTool({
				name: "list_issues",
				arguments: { cursor: "bm90LWEtY3Vyc29y" },
			});
			expect(badCursor.isError).toBe(true);
			expect(text(badCursor)).toMatch(/cursor/i);
			await client.close();
		});

		it("resolve_issue and ignore_issue need issues:write, and change the status", async () => {
			const { reader, writer, issueId } = await tokens();
			const readOnly = await connect(reader);
			const denied = await readOnly.callTool({
				name: "resolve_issue",
				arguments: { issue_id: issueId },
			});
			expect(denied.isError).toBe(true);
			expect(text(denied)).toMatch(/issues:write/);
			await readOnly.close();
			const client = await connect(writer);
			const resolved = JSON.parse(
				text(await client.callTool({ name: "resolve_issue", arguments: { issue_id: issueId } })),
			);
			expect(resolved).toMatchObject({ id: issueId, status: "resolved" });
			const ignored = JSON.parse(
				text(await client.callTool({ name: "ignore_issue", arguments: { issue_id: issueId } })),
			);
			expect(ignored.status).toBe("ignored");
			const missing = await client.callTool({
				name: "merge_issues",
				arguments: { target_id: issueId, source_ids: [999999] },
			});
			expect(missing.isError).toBe(true);
			await client.close();
		});

		it("claim_issue blocks a second agent; release_claim frees it; add_note adds to the timeline", async () => {
			const { writer, admin, issueId } = await tokens();
			const a = await connect(writer);
			const claimed = JSON.parse(
				text(
					await a.callTool({ name: "claim_issue", arguments: { issue_id: issueId, minutes: 30 } }),
				),
			);
			expect(claimed.claim.holder).toBe("writer");
			const b = await connect(admin);
			const unclaimed = JSON.parse(
				text(await b.callTool({ name: "list_issues", arguments: { claimed: false } })),
			);
			expect(unclaimed.issues.map((i: { id: number }) => i.id)).not.toContain(issueId);
			const all = JSON.parse(text(await b.callTool({ name: "list_issues", arguments: {} })));
			expect(all.issues.find((i: { id: number }) => i.id === issueId).claim.holder).toBe("writer");
			const blocked = await b.callTool({ name: "claim_issue", arguments: { issue_id: issueId } });
			expect(blocked.isError).toBe(true);
			expect(text(blocked)).toMatch(/claimed by writer until/);
			const otherAgent = await connect((await tokens()).writerB);
			const notHolder = await otherAgent.callTool({
				name: "release_claim",
				arguments: { issue_id: issueId },
			});
			expect(notHolder.isError).toBe(true);
			expect(text(notHolder)).toMatch(/claimed by writer until/);
			await otherAgent.close();
			const released = JSON.parse(
				text(await a.callTool({ name: "release_claim", arguments: { issue_id: issueId } })),
			);
			expect(released.claim).toBeNull();
			const note = JSON.parse(
				text(
					await a.callTool({
						name: "add_note",
						arguments: { issue_id: issueId, text: "Cause: missing null check." },
					}),
				),
			);
			expect(note).toMatchObject({ note_id: expect.any(Number) });
			const brief = text(
				await a.callTool({ name: "get_issue_brief", arguments: { issue_id: issueId } }),
			);
			expect(brief).toContain("note by writer: Cause: missing null check.");
			await a.close();
			await b.close();
		});

		it("accepts issue and event IDs as numeric strings", async () => {
			const { reader, issueId, eventId } = await tokens();
			const client = await connect(reader);
			const brief = text(
				await client.callTool({
					name: "get_issue_brief",
					arguments: { issue_id: String(issueId) },
				}),
			);
			expect(brief).toContain(`# Checkend issue ${issueId} (brief v1)`);
			const event = await client.callTool({
				name: "get_event",
				arguments: { event_id: String(eventId) },
			});
			expect(event.isError).toBeFalsy();
			expect(
				(await client.callTool({ name: "get_issue_brief", arguments: { issue_id: "4x" } })).isError,
			).toBe(true);
			await client.close();
		});

		it("link_fix sets fix_pending; it needs one of commit and pr_url, and issues:write", async () => {
			const { reader, writer, issueId } = await tokens();
			const client = await connect(writer);
			const sha = "0123456789abcdef0123456789abcdef01234567";
			const linked = await client.callTool({
				name: "link_fix",
				arguments: { issue_id: String(issueId), commit: sha },
			});
			expect(linked.isError).toBeFalsy();
			expect(JSON.parse(text(linked))).toMatchObject({
				status: "fix_pending",
				fix: { kind: "commit", commit: sha, linked_by: "writer", deployed_at: null },
			});
			for (const args of [
				{ issue_id: issueId },
				{ issue_id: issueId, commit: sha, pr_url: "https://github.com/acme/shop/pull/1" },
				{ issue_id: issueId, pr_url: "https://example.com/acme/shop/pull/1" },
			]) {
				expect((await client.callTool({ name: "link_fix", arguments: args })).isError).toBe(true);
			}
			await client.close();
			const readOnly = await connect(reader);
			const denied = await readOnly.callTool({
				name: "link_fix",
				arguments: { issue_id: issueId, commit: sha },
			});
			expect(denied.isError).toBe(true);
			const releases = await readOnly.callTool({ name: "list_releases", arguments: {} });
			expect(JSON.parse(text(releases))).toEqual({ releases: [] });
			await readOnly.close();
		});
	});
}
