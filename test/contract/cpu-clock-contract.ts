import { describe, expect, it } from "vitest";
import type { CpuClock } from "../../src/ports/cpu-clock.ts";

/** The behaviour every CpuClock adapter must have. */
export function cpuClockContract(adapterName: string, clock: CpuClock): void {
	describe(`CpuClock contract: ${adapterName}`, () => {
		it("grows with CPU work", () => {
			const before = clock.now();
			let x = 0;
			const until = performance.now() + 30;
			while (performance.now() < until) x += Math.sqrt(x + 1);
			expect(x).toBeGreaterThan(0);
			expect(clock.now() - before).toBeGreaterThan(10);
		});

		it("does not grow much while the process waits", async () => {
			const before = clock.now();
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(clock.now() - before).toBeLessThan(50);
		});
	});
}
