import { exports } from "cloudflare:workers";
import { mcpTransportSpike } from "../contract/mcp-spike.ts";

mcpTransportSpike("workerd", (request) => exports.default.fetch(request));
