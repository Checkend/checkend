import { IngestState } from "../../src/core/ingest/state.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { mcpContract } from "../contract/mcp-contract.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "mcp-node-test-admin-token-0123";
const t = await testPorts({ config: { adminToken: ADMIN } });
const app = createApp({ state: new IngestState() });
const reader = (
	await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "reader", scopes: ["issues:read"] })
).token;
const noRead = (
	await createToken(t.ports, BOOTSTRAP_ADMIN, { name: "no-read", scopes: ["releases:write"] })
).token;

mcpContract(
	"Node",
	async (request) => app.request(request, undefined, { ports: t.ports }),
	async () => ({ reader, noRead, admin: ADMIN }),
);
