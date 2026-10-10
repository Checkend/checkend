import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { mcpTransportSpike } from "../contract/mcp-spike.ts";
import { testPorts } from "../support/node-ports.ts";

const t = await testPorts();
const app = createApp({ state: new IngestState() });
mcpTransportSpike("Node", async (request) => app.request(request, undefined, { ports: t.ports }));
