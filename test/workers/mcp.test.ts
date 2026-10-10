import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { sql } from "../../src/ports/db.ts";
import { type McpTestTokens, mcpContract } from "../contract/mcp-contract.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

let tokens: Promise<McpTestTokens> | undefined;
const makeTokens = async (): Promise<McpTestTokens> => {
	const ports = cloudflarePorts(env, createExecutionContext());
	const project = await createProject(ports, { name: "Shop" });
	const raw = new TextEncoder().encode(
		JSON.stringify({ exception: { values: [{ type: "TypeError", value: "x is undefined" }] } }),
	);
	await storeEvent(
		ports,
		new IngestState(),
		project.internalId,
		await prepareEvent(raw, new Date()),
	);
	const issueId = (await ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
	const eventId = (await ports.db.first<{ id: number }>(sql`SELECT id FROM events`))?.id ?? 0;
	return {
		issueId,
		eventId,
		reader: (await createToken(ports, BOOTSTRAP_ADMIN, { name: "reader", scopes: ["issues:read"] }))
			.token,
		writer: (
			await createToken(ports, BOOTSTRAP_ADMIN, {
				name: "writer",
				scopes: ["issues:read", "issues:write"],
			})
		).token,
		writerB: (
			await createToken(ports, BOOTSTRAP_ADMIN, {
				name: "writer-b",
				scopes: ["issues:read", "issues:write"],
			})
		).token,
		noRead: (
			await createToken(ports, BOOTSTRAP_ADMIN, { name: "no-read", scopes: ["releases:write"] })
		).token,
		admin: env.ADMIN_TOKEN,
	};
};

mcpContract(
	"workerd",
	(request) => exports.default.fetch(request),
	() => {
		tokens ??= makeTokens();
		return tokens;
	},
);
