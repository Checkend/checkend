import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		name: "node",
		environment: "node",
		include: ["test/node/**/*.test.ts"],
	},
});
