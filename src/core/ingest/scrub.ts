/**
 * Secret scrubbing. Runs on every event before anything is stored, also on the raw payload.
 * Values of sensitive keys are replaced, and known secret formats inside strings are replaced.
 * The default list is fixed for now; a per-project list comes later.
 */
export const FILTERED = "[Filtered]";

// A key is sensitive when one of its words, or two adjacent words together, is in a list.
// Words come from camelCase, snake_case, kebab-case and spaces: "x-api-key" → x, api, key.
const SENSITIVE_WORDS = new Set([
	"password",
	"passwd",
	"pwd",
	"passphrase",
	"secret",
	"token",
	"auth",
	"authorization",
	"cookie",
	"cookies",
	"session",
	"sessionid",
	"csrf",
	"xsrf",
	"cvv",
	"cvc",
	"ssn",
	"dsn",
	"apikey",
	"privatekey",
	"creditcard",
	"accesstoken",
	"refreshtoken",
]);
const SENSITIVE_PAIRS = new Set([
	"apikey",
	"privatekey",
	"secretkey",
	"creditcard",
	"cardnumber",
	"accesstoken",
	"refreshtoken",
	"idtoken",
	"setcookie",
]);

export function isSensitiveKey(key: string): boolean {
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	for (let i = 0; i < words.length; i++) {
		const word = words[i] as string;
		if (SENSITIVE_WORDS.has(word)) return true;
		const next = words[i + 1];
		if (next !== undefined && SENSITIVE_PAIRS.has(word + next)) return true;
	}
	return false;
}

const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/g;
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;
const KNOWN_TOKENS =
	/\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g;
// Every pattern must run in linear time: scrubbing sees up to 256 KB of attacker text.
// A match starts at "://", so each start scans only to the next ":" or "/".
const URL_PASSWORD = /(:\/\/[^:/\s@]+:)([^@\s/]+)(@)/g;
// "<key>=<value>", "<key>: <value>" and "\"<key>\": \"<value>\"" inside text, also query
// parameters. The regex finds only the key and the separator (bounded); the value is found
// by a scan, and only for a sensitive key. So a non-sensitive match (for example "https:")
// does not hide a key later in the same value.
// The lookbehind lets a key start only where a word starts, so a long run of letters is
// tried once, not at each of its positions.
const KEY_SEPARATOR =
	/(?<![A-Za-z0-9_.-])(["']?)([A-Za-z][A-Za-z0-9_.-]{0,63})\1\s{0,8}[:=]\s{0,8}/g;
const MAYBE_SENSITIVE =
	/pass|pwd|secret|token|auth|cookie|session|csrf|xsrf|cvv|cvc|ssn|dsn|key|card/i;
const QUOTED_MAX = 512;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Replaces secret formats inside one string. */
// Cheap checks first: most strings contain none of the markers, and skip every regex.
const MAYBE_TOKEN = /_live_|_test_|AKIA|ASIA|gh[pousr]_|xox[abpr]-/;
const DIGIT_RUN = /\d{4}/;

export function scrubString(value: string): string {
	let out = value;
	if (out.includes("PRIVATE KEY")) out = scrubPrivateKeys(out);
	if (out.includes("Bearer") || out.includes("Basic") || out.includes("Token")) {
		out = out.replace(AUTH_SCHEME, (_m, scheme: string) => `${scheme} ${FILTERED}`);
	}
	if (out.includes("eyJ")) out = out.replace(JWT, FILTERED);
	if (MAYBE_TOKEN.test(out)) out = out.replace(KNOWN_TOKENS, FILTERED);
	if (out.includes("://") && out.includes("@")) {
		out = out.replace(
			URL_PASSWORD,
			(_m, before: string, _pw: string, at: string) => `${before}${FILTERED}${at}`,
		);
	}
	if ((out.includes("=") || out.includes(":")) && MAYBE_SENSITIVE.test(out)) {
		out = scrubKeyValues(out);
	}
	if (DIGIT_RUN.test(out)) {
		out = out.replace(CARD_CANDIDATE, (match) =>
			luhn(match.replace(/\D/g, "")) ? FILTERED : match,
		);
	}
	return out;
}

/**
 * Returns a scrubbed copy of a JSON value. The input must have a bounded depth
 * (parseJson() checks it), because the walk is recursive. With `patterns: false` only the
 * values of sensitive keys are replaced (for data whose strings are already scrubbed).
 */
export function scrub(
	value: unknown,
	options: { patterns: boolean } = { patterns: true },
): unknown {
	if (typeof value === "string") return options.patterns ? scrubString(value) : value;
	if (Array.isArray(value)) {
		// Header lists and tags are [name, value] pairs.
		if (value.length === 2 && typeof value[0] === "string" && isSensitiveKey(value[0])) {
			return [value[0], FILTERED];
		}
		return value.map((item) => scrub(item, options));
	}
	if (value !== null && typeof value === "object") {
		// fromEntries defines own properties, so a "__proto__" key stays a plain key.
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				isSensitiveKey(key) ? FILTERED : scrub(item, options),
			]),
		);
	}
	return value;
}

/** Replaces the value after each sensitive key in text. Linear: each step moves forward. */
function scrubKeyValues(text: string): string {
	let out = "";
	let copied = 0;
	KEY_SEPARATOR.lastIndex = 0;
	for (let match = KEY_SEPARATOR.exec(text); match; match = KEY_SEPARATOR.exec(text)) {
		if (!isSensitiveKey(match[2] ?? "")) continue;
		const value = findValue(text, KEY_SEPARATOR.lastIndex);
		if (value.end === value.start) continue;
		out += text.slice(copied, value.start) + FILTERED;
		copied = value.end;
		KEY_SEPARATOR.lastIndex = value.end;
	}
	return copied === 0 ? text : out + text.slice(copied);
}

/**
 * The part of the text to replace, after a separator. Quotes stay. A quoted value ends at
 * its closing quote (up to 512 characters, on one line). Otherwise the value ends at a space,
 * a quote, & or ; (also inside a quote that is too long or has no end).
 */
function findValue(text: string, at: number): { start: number; end: number } {
	const quote = text[at];
	let start = at;
	if (quote === '"' || quote === "'") {
		start = at + 1;
		const close = text.indexOf(quote, start);
		if (close !== -1 && close - at <= QUOTED_MAX && !text.slice(start, close).includes("\n")) {
			return { start, end: close };
		}
	}
	let end = start;
	while (end < text.length && !/[\s"'&;]/.test(text[end] as string)) end++;
	return { start, end };
}

const HEADER_MAX = 64;
const BEGIN_HEADER = /^-----BEGIN [A-Z ]*$/;

/**
 * Replaces PEM private key blocks, in linear time (a regex with a lazy span is quadratic on
 * many BEGIN markers). A block without an END marker is replaced to the end of the string.
 */
function scrubPrivateKeys(text: string): string {
	let out = "";
	let pos = 0;
	for (;;) {
		const begin = text.indexOf("-----BEGIN ", pos);
		if (begin === -1) break;
		const header = text.slice(begin, begin + HEADER_MAX);
		const label = header.indexOf("PRIVATE KEY-----");
		if (label === -1 || !BEGIN_HEADER.test(header.slice(0, label))) {
			out += text.slice(pos, begin + 1);
			pos = begin + 1;
			continue;
		}
		const end = text.indexOf("-----END ", begin + label);
		const close = end === -1 ? -1 : text.indexOf("PRIVATE KEY-----", end);
		out += text.slice(pos, begin) + FILTERED;
		pos = close === -1 ? text.length : close + "PRIVATE KEY-----".length;
	}
	return out + text.slice(pos);
}

function luhn(digits: string): boolean {
	let sum = 0;
	for (let i = 0; i < digits.length; i++) {
		let digit = Number(digits[digits.length - 1 - i]);
		if (i % 2 === 1) {
			digit *= 2;
			if (digit > 9) digit -= 9;
		}
		sum += digit;
	}
	return sum % 10 === 0;
}
