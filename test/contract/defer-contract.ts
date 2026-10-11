import { describe, expect, it } from "vitest";
import type { Defer } from "../../src/ports/defer.ts";

/** The behaviour every Defer adapter must have: the task runs; a failing task does not throw here. */
export function deferContract(
	adapterName: string,
	make: () => { defer: Defer; settle: () => Promise<void> },
): void {
	describe(`Defer contract: ${adapterName}`, () => {
		it("runs the task after the call, and a failing task does not throw at the call", async () => {
			const { defer, settle } = make();
			let done = false;
			defer(
				new Promise<void>((resolve) =>
					setTimeout(() => {
						done = true;
						resolve();
					}, 5),
				),
			);
			expect(() => defer(Promise.reject(new Error("failing task")).catch(() => {}))).not.toThrow();
			await settle();
			expect(done).toBe(true);
		});
	});
}
