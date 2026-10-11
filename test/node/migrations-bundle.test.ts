import { describe, expect, it } from "vitest";
import { readMigrations } from "../../src/adapters/node/migrations-fs.ts";
import { MIGRATIONS } from "../../src/entry/migrations.generated.ts";

describe("the migrations bundled for the hosted install", () => {
	it("are the files of migrations/ (run npm run migrations:build after adding one)", () => {
		expect(MIGRATIONS).toEqual(readMigrations("migrations"));
	});
});
