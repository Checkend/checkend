/**
 * Text from events is untrusted. Escaping (hono/html) stops markup; this makes characters
 * visible that hide or reorder text: control characters (except tab and newline), bidi
 * controls, zero-width characters, the byte order mark and Unicode tag characters. Ingest
 * already removes most of them; this is the second layer, for every value the UI shows.
 */
const HIDDEN =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: making control characters visible is the purpose.
	/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;

const marker = (char: string) =>
	`⟨U+${(char.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}⟩`;

/** Untrusted text for display: hidden characters marked, cut to `max` characters. */
export function displayText(value: unknown, max = 2000): string {
	if (value === null || value === undefined) return "";
	const text = typeof value === "string" ? value : String(value);
	const head = text.length > max * 2 ? text.slice(0, max * 2) : text;
	const shown = head.toWellFormed().replace(HIDDEN, marker);
	return shown.length > max ? `${shown.slice(0, max - 1)}…` : shown;
}
