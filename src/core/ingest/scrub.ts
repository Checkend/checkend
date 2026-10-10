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

const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]+=*/g;
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;
const KNOWN_TOKENS =
	/\b(?:(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)([^@\s/]+)(@)/gi;
const QUERY_PARAM = /(^|[?&])([A-Za-z0-9_.\-[\]]+)=([^&#\s]*)/g;
const CARD_CANDIDATE = /\b(?:\d[ -]?){12,18}\d\b/g;

/** Replaces secret formats inside one string. */
// Cheap checks first: most strings contain none of the markers, and skip every regex.
const MAYBE_TOKEN = /_live_|_test_|AKIA|ASIA|gh[pousr]_|xox[abpr]-/;
const DIGIT_RUN = /\d{4}/;

export function scrubString(value: string): string {
	let out = value;
	if (out.includes("PRIVATE KEY")) out = out.replace(PRIVATE_KEY, FILTERED);
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
	if (out.includes("=")) {
		out = out.replace(QUERY_PARAM, (match, sep: string, name: string) =>
			isSensitiveKey(name) ? `${sep}${name}=${FILTERED}` : match,
		);
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
