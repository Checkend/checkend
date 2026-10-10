import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { type McpTestTokens, mcpContract } from "../contract/mcp-contract.ts";

await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);

let tokens: Promise<McpTestTokens> | undefined;
const makeTokens = async (): Promise<McpTestTokens> => {
	const ports = cloudflarePorts(env, createExecutionContext());
	return {
		reader: (await createToken(ports, BOOTSTRAP_ADMIN, { name: "reader", scopes: ["issues:read"] }))
			.token,
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
