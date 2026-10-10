import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	buildSourceMapIndex,
	decodeMappings,
	InvalidSourceMap,
	lookupPosition,
	openSourceMapIndex,
	sourceLines,
} from "../../src/core/sourcemap-index.ts";

const map = JSON.parse(readFileSync("test/fixtures/sourcemaps/app.min.js.map", "utf8"));

describe("source map index: build once, then look up", () => {
	it("maps a minified position to the original file, line and column", () => {
		const index = openSourceMapIndex(buildSourceMapIndex(map));
		// `t.lines` in the minified bundle is `cart.lines` on line 13 of src/cart.ts.
		expect(lookupPosition(index, 1, 579)).toEqual({
			source: "src/cart.ts",
			sourceIndex: 0,
			line: 13,
			column: 21,
			name: "cart",
		});
		expect(lookupPosition(index, 1, 525)).toMatchObject({
			source: "src/cart.ts",
			line: 8,
			column: 9,
		});
	});

	it("uses the nearest segment on the left; no segment, or another line: null", () => {
		const index = openSourceMapIndex(buildSourceMapIndex(map));
		expect(lookupPosition(index, 1, 580)).toMatchObject({ line: 13, column: 21 });
		expect(lookupPosition(index, 1, 1)).toBeNull();
		expect(lookupPosition(index, 2, 1)).toBeNull();
		expect(lookupPosition(index, 99, 1)).toBeNull();
	});

	it("keeps the source contents, and returns the lines around a line", () => {
		const index = openSourceMapIndex(buildSourceMapIndex(map));
		expect(sourceLines(index, 0, 13, 2)).toEqual({
			pre: ["export function cartTotal(cart: { lines?: Line[] }): number {", "\tlet total = 0;"],
			line: "\tfor (const line of cart.lines!) {",
			post: ["\t\ttotal += lineTotal(line);", "\t}"],
		});
		expect(sourceLines(index, 0, 999, 2)).toBeNull();
		const noContent = openSourceMapIndex(
			buildSourceMapIndex({ ...map, sourcesContent: undefined }),
		);
		expect(sourceLines(noContent, 0, 13, 2)).toBeNull();
	});

	it("rejects maps that it cannot index", () => {
		for (const bad of [
			null,
			{ ...map, version: 2 },
			{ ...map, mappings: 42 },
			{ ...map, mappings: "A!" },
			{ ...map, sources: "src/cart.ts" },
			{ version: 3, sections: [] },
			{ ...map, mappings: "AKAA" }, // source 5: not in the sources
		]) {
			expect(() => buildSourceMapIndex(bad), JSON.stringify(bad)?.slice(0, 40)).toThrow(
				InvalidSourceMap,
			);
		}
	});
});

/** Encodes segments as VLQ mappings (the reference: the Source Map v3 format). */
function encode(lines: number[][][]): string {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	const vlq = (value: number) => {
		let v = value < 0 ? (-value << 1) | 1 : value << 1;
		let out = "";
		do {
			let digit = v & 31;
			v >>>= 5;
			if (v > 0) digit |= 32;
			out += chars[digit];
		} while (v > 0);
		return out;
	};
	const previous = [0, 0, 0, 0];
	return lines
		.map((segments) => {
			let column = 0;
			return segments
				.map((s) => {
					let text = vlq((s[0] ?? 0) - column);
					column = s[0] ?? 0;
					for (let i = 1; i < s.length; i++) {
						text += vlq((s[i] ?? 0) - (previous[i - 1] ?? 0));
						previous[i - 1] = s[i] ?? 0;
					}
					return text;
				})
				.join(",");
		})
		.join(";");
}

describe("VLQ mappings", () => {
	it("decodes what the reference encoder writes (property test)", () => {
		const segment = fc.oneof(
			fc.tuple(fc.nat(5000)),
			fc.tuple(fc.nat(5000), fc.nat(3), fc.nat(100_000), fc.nat(500)),
			fc.tuple(fc.nat(5000), fc.nat(3), fc.nat(100_000), fc.nat(500), fc.nat(50)),
		);
		const sorted = fc
			.array(segment, { maxLength: 20 })
			.map((s) => [...s].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0)) as number[][]);
		fc.assert(
			fc.property(fc.array(sorted, { maxLength: 10 }), (lines) => {
				// Trailing empty lines have no text in the mappings: compare without them.
				const trim = (value: number[][][]) => {
					const copy = [...value];
					while (copy.length > 0 && copy.at(-1)?.length === 0) copy.pop();
					return copy;
				};
				expect(trim(decodeMappings(encode(lines)))).toEqual(trim(lines));
			}),
		);
	});
});

describe("index bytes from a client are untrusted", () => {
	it("rejects bytes that are not a valid index", () => {
		const good = buildSourceMapIndex(map);
		expect(() => openSourceMapIndex(new Uint8Array([1, 2, 3]))).toThrow(InvalidSourceMap);
		expect(() => openSourceMapIndex(good.slice(0, good.length - 10))).toThrow(InvalidSourceMap);
		const badMagic = good.slice();
		badMagic[0] = 0;
		expect(() => openSourceMapIndex(badMagic)).toThrow(InvalidSourceMap);
	});

	it("never crashes on random changes: open throws InvalidSourceMap, or lookups are safe", () => {
		const good = buildSourceMapIndex(map);
		fc.assert(
			fc.property(
				fc.array(fc.tuple(fc.nat(good.length - 1), fc.nat(255)), { minLength: 1, maxLength: 8 }),
				fc.nat(5),
				fc.nat(2000),
				(changes, line, column) => {
					const bytes = good.slice();
					for (const [at, value] of changes) bytes[at] = value;
					let index: ReturnType<typeof openSourceMapIndex>;
					try {
						index = openSourceMapIndex(bytes);
					} catch (error) {
						expect(error).toBeInstanceOf(InvalidSourceMap);
						return;
					}
					const position = lookupPosition(index, line, column);
					if (position) sourceLines(index, position.sourceIndex, position.line, 3);
				},
			),
			{ numRuns: 500 },
		);
	});
});
