import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { BOOTSTRAP_ADMIN, createToken } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
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

const project = await createProject(t.ports, { name: "Shop" });
const raw = new TextEncoder().encode(
	JSON.stringify({ exception: { values: [{ type: "TypeError", value: "x is undefined" }] } }),
);
await storeEvent(
	t.ports,
	new IngestState(),
	project.internalId,
	await prepareEvent(raw, t.clock.now()),
);
const writer = (
	await createToken(t.ports, BOOTSTRAP_ADMIN, {
		name: "writer",
		scopes: ["issues:read", "issues:write"],
	})
).token;
const issueId = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM issues`))?.id ?? 0;
const eventId = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM events`))?.id ?? 0;

mcpContract(
	"Node",
	async (request) => app.request(request, undefined, { ports: t.ports }),
	async () => ({ reader, writer, noRead, admin: ADMIN, issueId, eventId }),
);
