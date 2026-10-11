import type { CpuClock } from "../../ports/cpu-clock.ts";

/** CPU time of the Node process (user + system), in milliseconds. */
export const processCpuClock: CpuClock = {
	now() {
		const usage = process.cpuUsage();
		return (usage.user + usage.system) / 1000;
	},
};
