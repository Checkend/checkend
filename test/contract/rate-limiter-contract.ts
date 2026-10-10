import { describe, expect, it } from "vitest";
import type { RateLimiter } from "../../src/ports/rate-limiter.ts";

/** The behaviour every RateLimiter adapter must have, for an adapter with `limit` per period. */
export function rateLimiterContract(
	adapterName: string,
	limit: number,
	make: () => RateLimiter,
): void {
	describe(`RateLimiter contract: ${adapterName}`, () => {
		it("allows a key up to its limit, then denies it; other keys are not affected", async () => {
			const limiter = make();
			const key = `contract-${crypto.randomUUID()}`;
			const results: boolean[] = [];
			for (let i = 0; i < limit + 5; i++) results.push(await limiter.allow(key));
			expect(results.slice(0, limit).every(Boolean)).toBe(true);
			expect(results.slice(limit).some((allowed) => !allowed)).toBe(true);
			expect(await limiter.allow(`other-${crypto.randomUUID()}`)).toBe(true);
		});
	});
}
