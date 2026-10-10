import { defineConfig } from "vitest/config";

// Performance budgets. One file at a time, so that other tests do not share the CPU.
export default defineConfig({
	test: {
		name: "perf",
		environment: "node",
		include: ["test/perf/**/*.test.ts"],
		fileParallelism: false,
	},
});
