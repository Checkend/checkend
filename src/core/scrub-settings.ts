import * as v from "valibot";
import { FILTERED } from "./ingest/scrub.ts";

/**
 * Scrub settings per project, on top of the default scrubbing (ingest/scrub.ts):
 * - scrub_keys: literal key names (any case) whose values are always filtered. Preferred: they
 *   cost no regular expression time.
 * - scrub_patterns: regular expressions; every match in every string is filtered. The text that
 *   they run on comes from attackers (up to 256 KB per string), so a pattern must be fast on any
 *   input. At save time: at most 200 characters, no backreferences, no nested quantifiers such
 *   as (a+)+, and a timed run on slow inputs of growing length built from the pattern itself.
 *   Timing: in Node the clock moves during the runs, so each run is checked and the check stops
 *   early. On Workers, Date.now() is the time of the last I/O: the per-run checks see 0 ms, so
 *   the whole battery is also timed between two real I/O calls (ioTick, a database query) and
 *   compared with TOTAL_BUDGET_MS. A pattern that never finishes is stopped by the CPU limit of
 *   the request, and is not saved either.
 */
export const MAX_SCRUB_KEYS = 50;
export const MAX_SCRUB_PATTERNS = 10;
export const MAX_PATTERN_CHARS = 200;
/** A run slower than this rejects the pattern. */
const STEP_BUDGET_MS = 50;
/** All runs together, timed between two I/O calls. */
const TOTAL_BUDGET_MS = 250;
/** Input lengths: small steps first (exponential patterns), then doubling (polynomial ones). */
const LENGTHS = [
	4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 48, 64, 128, 256, 512, 1024, 2048, 4096,
	8192, 16384,
];

export const ScrubKey = v.pipe(
	v.string(),
	v.regex(/^[A-Za-z0-9_.-]{1,64}$/, "A key is 1 to 64 letters, digits, _ . or -."),
	v.transform((key) => key.toLowerCase()),
);

export interface ProjectScrub {
	keys: Set<string>;
	patterns: RegExp[];
}

export type PatternCheck = { ok: true } | { ok: false; reason: string };

/** True when a group with a quantifier inside is itself repeated: (a+)+, (x*y)*, (\d+){2,}. */
function hasNestedQuantifier(source: string): boolean {
	const groups: { quantified: boolean }[] = [];
	let inClass = false;
	for (let i = 0; i < source.length; i++) {
		const char = source[i];
		if (char === "\\") {
			i++;
			continue;
		}
		if (inClass) {
			if (char === "]") inClass = false;
			continue;
		}
		if (char === "[") inClass = true;
		else if (char === "(") groups.push({ quantified: false });
		else if (char === "*" || char === "+" || (char === "{" && /^\{\d*,/.test(source.slice(i)))) {
			for (const group of groups) group.quantified = true;
		} else if (char === ")") {
			const group = groups.pop();
			const next = source.slice(i + 1);
			const repeated = /^(\*|\+|\{\d*,\d*\}|\{\d{2,}\})/.test(next);
			if (group?.quantified && repeated) return true;
			if (group?.quantified) for (const outer of groups) outer.quantified = true;
		}
	}
	return false;
}

/** Characters for slow inputs: the literal characters of the pattern, and common classes. */
function inputChars(source: string): string[] {
	const chars = new Set(["a", "0", " ", "-"]);
	for (const [, char] of source.matchAll(/(?<!\\)([A-Za-z0-9_@.:/-])/g)) {
		if (char) chars.add(char);
	}
	return [...chars].slice(0, 12);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Checks a pattern before it is saved. ioTick: a real I/O call that moves the Workers clock
 * (updateProject passes a database query); by default a timer.
 */
export async function checkScrubPattern(
	source: string,
	ioTick: () => Promise<unknown> = tick,
): Promise<PatternCheck> {
	if (source.length === 0 || source.length > MAX_PATTERN_CHARS) {
		return { ok: false, reason: `A pattern has 1 to ${MAX_PATTERN_CHARS} characters.` };
	}
	if (/\\[1-9]|\\k</.test(source)) return { ok: false, reason: "Backreferences are not allowed." };
	let re: RegExp;
	try {
		re = new RegExp(source, "g");
	} catch {
		return { ok: false, reason: "Not a valid regular expression." };
	}
	if (hasNestedQuantifier(source)) {
		return { ok: false, reason: "A nested quantifier, for example (a+)+, can be very slow." };
	}
	// One timed step per length, over all the characters (few clock ticks per pattern).
	const chars = inputChars(source);
	await ioTick();
	const battery = Date.now();
	for (const length of LENGTHS) {
		await tick();
		const started = Date.now();
		for (const char of chars) {
			re.lastIndex = 0;
			`${char.repeat(length)}!`.replace(re, "");
		}
		await tick();
		if (Date.now() - started > STEP_BUDGET_MS) {
			return {
				ok: false,
				reason: `The pattern is too slow on a long input (${length} characters).`,
			};
		}
	}
	await ioTick();
	if (Date.now() - battery > TOTAL_BUDGET_MS) {
		return { ok: false, reason: "The pattern is too slow on long inputs." };
	}
	return { ok: true };
}

/** Compiles stored settings (already checked at save time). Null when there are none. */
export function compileScrub(
	keys: string[] | null,
	patterns: string[] | null,
): ProjectScrub | null {
	if (!keys?.length && !patterns?.length) return null;
	return {
		keys: new Set((keys ?? []).map((k) => k.toLowerCase())),
		patterns: (patterns ?? []).map((p) => new RegExp(p, "g")),
	};
}

/** Applies the project settings to a JSON value: literal keys, then patterns in strings. */
export function applyProjectScrub(value: unknown, scrub: ProjectScrub): unknown {
	if (typeof value === "string") {
		let out = value;
		for (const re of scrub.patterns) {
			re.lastIndex = 0;
			out = out.replace(re, FILTERED);
		}
		return out;
	}
	if (Array.isArray(value)) {
		// Header lists and tags are [name, value] pairs.
		if (
			value.length === 2 &&
			typeof value[0] === "string" &&
			scrub.keys.has(value[0].toLowerCase())
		) {
			return [value[0], FILTERED];
		}
		return value.map((item) => applyProjectScrub(item, scrub));
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				scrub.keys.has(key.toLowerCase()) ? FILTERED : applyProjectScrub(item, scrub),
			]),
		);
	}
	return value;
}
