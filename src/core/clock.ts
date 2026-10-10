import type { Clock } from "../ports/clock.ts";

/** The real time. Portable: it uses only `Date`. */
export const systemClock: Clock = {
	now: () => new Date(),
};

export interface FixedClock extends Clock {
	advance(ms: number): void;
}

/** A clock for tests. Time moves only when `advance()` is called. */
export function fixedClock(start: Date): FixedClock {
	let time = start.getTime();
	return {
		now: () => new Date(time),
		advance: (ms) => {
			time += ms;
		},
	};
}
