/**
 * Source maps, processed once into a compact binary line index (M3). At event time a lookup
 * is a binary search over the index bytes: no JSON parsing and no VLQ decoding, so that it fits
 * the CPU budget of a request. The index also holds the source contents, so that one stored
 * object per map is enough.
 *
 * Index format v1, little-endian; u32 = unsigned 32-bit, i32 = signed 32-bit:
 *   header      9 x u32: magic "CKSI", version, lines, segments, sources, names,
 *               source name bytes, name bytes, content bytes
 *   lineStarts  u32[lines + 1]      the first segment of each generated line
 *   segments    i32[segments * 5]   generated column, source (-1: none), original line,
 *                                   original column, name (-1: none); all 0-based
 *   sourceEnds  u32[sources + 1]    offsets into the source name bytes
 *   nameEnds    u32[names + 1]      offsets into the name bytes
 *   contentEnds u32[sources + 1]    offsets into the content bytes (empty: no content)
 *   then the UTF-8 bytes: source names, names, contents.
 * Index bytes can come from a client (a prebuilt index): openSourceMapIndex checks every size
 * and offset table, and lookups check each value they use.
 */

export class InvalidSourceMap extends Error {}

const MAGIC = 0x4953_4b43; // "CKSI" read as a little-endian u32
const VERSION = 1;
const HEADER_WORDS = 9;
const FIELDS = 5;
/** Limits for one map: about 40 MB of segments. */
export const MAX_SEGMENTS = 2_000_000;
export const MAX_LINES = 1_000_000;

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) DIGIT[BASE64.charCodeAt(i)] = i;

/**
 * Decodes the `mappings` of a source map into absolute values, per generated line: each segment
 * is [column] or [column, source, line, column] or [column, source, line, column, name].
 */
export function decodeMappings(mappings: string): number[][][] {
	if (mappings === "") return [];
	const lines: number[][][] = [];
	let segments: number[][] = [];
	let segment: number[] = [];
	const state = [0, 0, 0, 0, 0]; // column (per line), source, line, column, name
	let value = 0;
	let shift = 0;
	let count = 0;
	const endSegment = () => {
		if (segment.length === 0) return;
		if (segment.length !== 1 && segment.length !== 4 && segment.length !== 5) {
			throw new InvalidSourceMap("A mapping segment has 2 or 3 fields.");
		}
		segments.push(segment);
		count++;
		if (count > MAX_SEGMENTS) throw new InvalidSourceMap("The source map has too many mappings.");
		segment = [];
	};
	for (let i = 0; i <= mappings.length; i++) {
		const code = i < mappings.length ? mappings.charCodeAt(i) : 59; // end: like ";"
		if (code === 44 || code === 59) {
			if (shift !== 0) throw new InvalidSourceMap("A VLQ value is not complete.");
			endSegment();
			if (code === 59) {
				lines.push(segments);
				if (lines.length > MAX_LINES)
					throw new InvalidSourceMap("The source map has too many lines.");
				segments = [];
				state[0] = 0;
			}
			continue;
		}
		const digit = code < 128 ? (DIGIT[code] ?? -1) : -1;
		if (digit < 0) throw new InvalidSourceMap("The mappings have a character that is not base64.");
		value += (digit & 31) * 2 ** shift;
		shift += 5;
		if (shift > 35) throw new InvalidSourceMap("A VLQ value is too large.");
		if (digit & 32) continue;
		const delta = value % 2 === 1 ? -Math.floor(value / 2) : value / 2;
		const field = segment.length;
		if (field >= FIELDS) throw new InvalidSourceMap("A mapping segment has more than 5 fields.");
		state[field] = (state[field] ?? 0) + delta;
		const absolute = state[field] ?? 0;
		if (absolute < 0) throw new InvalidSourceMap("A mapping value is negative.");
		segment.push(absolute);
		value = 0;
		shift = 0;
	}
	// The loop adds one line for the end of the text; the input has one line fewer ";".
	return lines;
}

interface SourceMapV3 {
	version: 3;
	sources: (string | null)[];
	names?: string[];
	mappings: string;
	sourceRoot?: string;
	sourcesContent?: (string | null)[];
}

function checkMap(map: unknown): SourceMapV3 {
	if (typeof map !== "object" || map === null) throw new InvalidSourceMap("Not a JSON object.");
	const m = map as Record<string, unknown>;
	if ("sections" in m) throw new InvalidSourceMap("Index maps (sections) are not supported.");
	if (m.version !== 3) throw new InvalidSourceMap("Only source map version 3 is supported.");
	if (typeof m.mappings !== "string") throw new InvalidSourceMap("mappings is not a string.");
	const strings = (value: unknown, nullable: boolean) =>
		Array.isArray(value) && value.every((v) => typeof v === "string" || (nullable && v === null));
	if (!strings(m.sources, true)) throw new InvalidSourceMap("sources is not a list of strings.");
	if (m.names !== undefined && !strings(m.names, false)) {
		throw new InvalidSourceMap("names is not a list of strings.");
	}
	if (
		m.sourcesContent !== undefined &&
		m.sourcesContent !== null &&
		!strings(m.sourcesContent, true)
	) {
		throw new InvalidSourceMap("sourcesContent is not a list of strings.");
	}
	return m as unknown as SourceMapV3;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Builds the index of a source map (the parsed JSON). Throws InvalidSourceMap. */
export function buildSourceMapIndex(json: unknown): Uint8Array {
	const map = checkMap(json);
	const lines = decodeMappings(map.mappings);
	const root = map.sourceRoot ? map.sourceRoot.replace(/\/?$/, "/") : "";
	const sources = map.sources.map((s) => (s === null ? "" : root + s));
	const names = map.names ?? [];
	const contents = sources.map((_, i) => map.sourcesContent?.[i] ?? "");

	let segmentCount = 0;
	for (const line of lines) segmentCount += line.length;
	const encodeAll = (values: string[]) => {
		const parts = values.map((v) => encoder.encode(v));
		const ends = new Uint32Array(parts.length + 1);
		let total = 0;
		parts.forEach((part, i) => {
			total += part.length;
			ends[i + 1] = total;
		});
		const bytes = new Uint8Array(total);
		parts.forEach((part, i) => {
			bytes.set(part, ends[i]);
		});
		return { ends, bytes };
	};
	const sourceTable = encodeAll(sources);
	const nameTable = encodeAll(names);
	const contentTable = encodeAll(contents);

	const words =
		HEADER_WORDS +
		(lines.length + 1) +
		segmentCount * FIELDS +
		(sources.length + 1) * 2 +
		(names.length + 1);
	const size =
		words * 4 + sourceTable.bytes.length + nameTable.bytes.length + contentTable.bytes.length;
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	let at = 0;
	const u32 = (value: number) => {
		view.setUint32(at, value, true);
		at += 4;
	};
	const i32 = (value: number) => {
		view.setInt32(at, value, true);
		at += 4;
	};
	for (const value of [
		MAGIC,
		VERSION,
		lines.length,
		segmentCount,
		sources.length,
		names.length,
		sourceTable.bytes.length,
		nameTable.bytes.length,
		contentTable.bytes.length,
	]) {
		u32(value);
	}
	let start = 0;
	for (const line of lines) {
		u32(start);
		start += line.length;
	}
	u32(start);
	for (const line of lines) {
		const sorted = [...line].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0));
		for (const s of sorted) {
			const hasSource = s.length >= 4;
			const source = hasSource ? (s[1] ?? 0) : -1;
			const name = s.length === 5 ? (s[4] ?? 0) : -1;
			if (source >= sources.length)
				throw new InvalidSourceMap("A mapping names a source that is not listed.");
			if (name >= names.length)
				throw new InvalidSourceMap("A mapping names a name that is not listed.");
			const values = [
				s[0] ?? 0,
				source,
				hasSource ? (s[2] ?? 0) : 0,
				hasSource ? (s[3] ?? 0) : 0,
				name,
			];
			if (values.some((v) => v > 0x7fff_ffff))
				throw new InvalidSourceMap("A mapping value is too large.");
			for (const value of values) i32(value);
		}
	}
	for (const table of [sourceTable, nameTable]) for (const end of table.ends) u32(end);
	for (const end of contentTable.ends) u32(end);
	for (const table of [sourceTable, nameTable, contentTable]) {
		out.set(table.bytes, at);
		at += table.bytes.length;
	}
	return out;
}

export interface SourceMapIndex {
	view: DataView;
	bytes: Uint8Array;
	lines: number;
	segments: number;
	sources: number;
	names: number;
	lineStarts: number;
	segmentStart: number;
	sourceEnds: number;
	nameEnds: number;
	contentEnds: number;
	sourceBytes: number;
	nameBytes: number;
	contentBytes: number;
}

/** Opens index bytes: checks the header, the size and the offset tables. */
export function openSourceMapIndex(bytes: Uint8Array): SourceMapIndex {
	const fail = (why: string) => new InvalidSourceMap(`Not a valid source map index: ${why}.`);
	if (bytes.byteLength < HEADER_WORDS * 4) throw fail("too short");
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const word = (i: number) => view.getUint32(i * 4, true);
	if (word(0) !== MAGIC || word(1) !== VERSION) throw fail("unknown format");
	const [lines, segments, sources, names, sourceLength, nameLength, contentLength] = [
		2, 3, 4, 5, 6, 7, 8,
	].map(word) as [number, number, number, number, number, number, number];
	if (lines > MAX_LINES || segments > MAX_SEGMENTS) throw fail("too large");
	const lineStarts = HEADER_WORDS * 4;
	const segmentStart = lineStarts + (lines + 1) * 4;
	const sourceEnds = segmentStart + segments * FIELDS * 4;
	const nameEnds = sourceEnds + (sources + 1) * 4;
	const contentEnds = nameEnds + (names + 1) * 4;
	const sourceBytes = contentEnds + (sources + 1) * 4;
	const nameBytes = sourceBytes + sourceLength;
	const contentBytes = nameBytes + nameLength;
	if (contentBytes + contentLength !== bytes.byteLength) throw fail("the size does not match");
	const ascending = (offset: number, count: number, last: number) => {
		let previous = 0;
		for (let i = 0; i <= count; i++) {
			const value = view.getUint32(offset + i * 4, true);
			if (value < previous || (i === 0 && value !== 0)) return false;
			previous = value;
		}
		return previous === last;
	};
	if (!ascending(lineStarts, lines, segments)) throw fail("bad line table");
	if (!ascending(sourceEnds, sources, sourceLength)) throw fail("bad source table");
	if (!ascending(nameEnds, names, nameLength)) throw fail("bad name table");
	if (!ascending(contentEnds, sources, contentLength)) throw fail("bad content table");
	return {
		view,
		bytes,
		lines,
		segments,
		sources,
		names,
		lineStarts,
		segmentStart,
		sourceEnds,
		nameEnds,
		contentEnds,
		sourceBytes,
		nameBytes,
		contentBytes,
	};
}

function text(index: SourceMapIndex, ends: number, base: number, i: number): string {
	const start = index.view.getUint32(ends + i * 4, true);
	const end = index.view.getUint32(ends + (i + 1) * 4, true);
	return decoder.decode(index.bytes.subarray(base + start, base + end));
}

export interface OriginalPosition {
	source: string;
	sourceIndex: number;
	/** 1-based. */
	line: number;
	/** 1-based. */
	column: number;
	name: string | null;
}

/**
 * The original position of a generated position (line and column 1-based, as in stack frames):
 * the nearest mapping at or to the left of the column, on the same line. Null when there is none.
 */
export function lookupPosition(
	index: SourceMapIndex,
	line: number,
	column: number,
): OriginalPosition | null {
	const l = line - 1;
	const c = column - 1;
	if (!Number.isInteger(l) || l < 0 || l >= index.lines || c < 0) return null;
	const { view } = index;
	let low = view.getUint32(index.lineStarts + l * 4, true);
	let high = view.getUint32(index.lineStarts + (l + 1) * 4, true) - 1;
	let found = -1;
	while (low <= high) {
		const mid = (low + high) >>> 1;
		const generated = view.getInt32(index.segmentStart + mid * FIELDS * 4, true);
		if (generated <= c) {
			found = mid;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}
	if (found < 0) return null;
	const field = (n: number) => view.getInt32(index.segmentStart + (found * FIELDS + n) * 4, true);
	const source = field(1);
	const originalLine = field(2);
	const originalColumn = field(3);
	const name = field(4);
	if (source < 0 || source >= index.sources || originalLine < 0 || originalColumn < 0) return null;
	return {
		source: text(index, index.sourceEnds, index.sourceBytes, source),
		sourceIndex: source,
		line: originalLine + 1,
		column: originalColumn + 1,
		name:
			name >= 0 && name < index.names ? text(index, index.nameEnds, index.nameBytes, name) : null,
	};
}

/** The lines around `line` (1-based) of an original source, or null without its content. */
export function sourceLines(
	index: SourceMapIndex,
	sourceIndex: number,
	line: number,
	around: number,
): { pre: string[]; line: string; post: string[] } | null {
	if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= index.sources)
		return null;
	const content = text(index, index.contentEnds, index.contentBytes, sourceIndex);
	if (!content) return null;
	const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
	const at = line - 1;
	const current = lines[at];
	if (current === undefined || at < 0) return null;
	return {
		pre: lines.slice(Math.max(0, at - around), at),
		line: current,
		post: lines.slice(at + 1, at + 1 + around),
	};
}
