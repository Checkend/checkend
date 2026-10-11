import { nodeDefer } from "../../src/adapters/node/defer.ts";
import { systemResolver } from "../../src/adapters/node/resolver.ts";
import { deferContract } from "../contract/defer-contract.ts";
import { resolverContract } from "../contract/resolver-contract.ts";

resolverContract("system resolver (Node)", systemResolver);
deferContract("Node (drain)", () => {
	const { defer, drain } = nodeDefer();
	return { defer, settle: drain };
});
