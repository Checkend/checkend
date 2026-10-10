import { readFileSync } from "node:fs";
import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { BriefJson } from "../../src/core/brief.ts";
import { BriefJsonSchema, briefJsonSchemaText } from "../../src/core/brief-schema.ts";

/**
 * The open spec of the brief (spec/) must match what Checkend sends. The other brief tests build
 * briefs in many states; this file checks the schema itself, and the TypeScript type.
 */
describe("brief v1 schema (the open spec)", () => {
	it("is the same type as the BriefJson that the code builds", () => {
		expectTypeOf<v.InferOutput<typeof BriefJsonSchema>>().toEqualTypeOf<BriefJson>();
	});

	it("is committed as spec/schemas/brief-v1.schema.json (run npm run spec:build)", () => {
		expect(readFileSync("spec/schemas/brief-v1.schema.json", "utf8")).toBe(briefJsonSchemaText());
	});

	it("rejects a field that the spec does not have", () => {
		const brief = {
			brief_version: 1,
			untrusted_notice: "x",
			issue: {},
			untrusted: {},
			truncated: false,
			extra: true,
		};
		expect(v.safeParse(BriefJsonSchema, brief).success).toBe(false);
	});
});
