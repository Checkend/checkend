import { describe, expect, it } from "vitest";
import type { Resolver } from "../../src/ports/resolver.ts";

/**
 * The behaviour every Resolver adapter must have. It needs no network: a name under .invalid
 * never exists (RFC 6761), so every adapter gives no addresses, also when the lookup fails.
 */
export function resolverContract(adapterName: string, resolver: Resolver): void {
	describe(`Resolver contract: ${adapterName}`, () => {
		it("gives no addresses for a name that does not exist, and does not throw", async () => {
			expect(await resolver.resolve(`checkend-${crypto.randomUUID()}.invalid`)).toEqual([]);
		});
	});
}
