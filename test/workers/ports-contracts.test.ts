import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { dohResolver } from "../../src/adapters/cloudflare/resolver.ts";
import { deferContract } from "../contract/defer-contract.ts";
import { resolverContract } from "../contract/resolver-contract.ts";

resolverContract("DNS over HTTPS (Workers)", dohResolver);
deferContract("Workers (waitUntil)", () => {
	const ctx = createExecutionContext();
	return { defer: (task) => ctx.waitUntil(task), settle: () => waitOnExecutionContext(ctx) };
});
