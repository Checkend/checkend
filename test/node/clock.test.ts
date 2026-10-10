import { describe, expect, it } from "vitest";
import { fixedClock, systemClock } from "../../src/core/clock";

describe("Clock port", () => {
	it("systemClock returns the current time", () => {
		const before = Date.now();
		const now = systemClock.now().getTime();
		expect(now).toBeGreaterThanOrEqual(before);
		expect(now).toBeLessThanOrEqual(Date.now());
	});

	it("fixedClock returns the time it was given until it is advanced", () => {
		const clock = fixedClock(new Date("2026-10-10T12:00:00Z"));
		expect(clock.now().toISOString()).toBe("2026-10-10T12:00:00.000Z");
		clock.advance(90_000);
		expect(clock.now().toISOString()).toBe("2026-10-10T12:01:30.000Z");
	});

	it("fixedClock returns a copy, so callers cannot change its time", () => {
		const clock = fixedClock(new Date("2026-10-10T12:00:00Z"));
		clock.now().setFullYear(2000);
		expect(clock.now().getFullYear()).toBe(2026);
	});
});
