import * as v from "valibot";
import { expect } from "vitest";
import type { Brief } from "../../src/core/brief.ts";
import { BriefJsonSchema } from "../../src/core/brief-schema.ts";

/** Checks a brief against the open spec (spec/schemas/brief-v1.schema.json). */
export function expectSpecBrief(brief: Brief | null | undefined): void {
	expect(brief).toBeTruthy();
	const result = v.safeParse(BriefJsonSchema, brief?.json);
	expect(
		result.success ? [] : result.issues.map((i) => `${v.getDotPath(i)}: ${i.message}`),
	).toEqual([]);
}
