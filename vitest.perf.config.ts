import { defineConfig } from "vitest/config";

// Performance budgets. One file at a time, so that other tests do not share the CPU.
export default defineConfig({
	test: {
		name: "perf",
		environment: "node",
		include: ["test/perf/**/*.test.ts"],
		fileParallelism: false,
		// Slow CI runners need more time; the assertions use ratios, not absolute times.
		testTimeout: 120_000,
		// Print the measured ratios also when the tests pass: a log shows the margin to the limit.
		silent: false,
	},
});
