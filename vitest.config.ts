import { defineConfig } from "vitest/config";

// Two projects: "node" (core, SQLite adapter, tools) and "workers" (workerd: D1 adapter, Worker entry).
export default defineConfig({
	test: {
		projects: ["./vitest.node.config.ts", "./vitest.workers.config.ts"],
	},
});
