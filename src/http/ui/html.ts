import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

/**
 * The only way the UI writes HTML. `h` is hono/html with a narrow type: a value is a string
 * or a number (escaped), another `h` result, a list of them, or nothing. Plain objects are
 * not allowed, so event data must go through `displayText()` first. There is no raw HTML:
 * a test fails when `raw` or `dangerouslySetInnerHTML` appears in src/http/ui.
 */
export type Html = HtmlEscapedString;
export type Child = string | number | boolean | null | undefined | Html | readonly Child[];

export const h = html as unknown as (strings: TemplateStringsArray, ...values: Child[]) => Html;

/** Relative time, for example "5 min ago", from the server clock. */
export function ago(iso: string | number | null | undefined, now: Date): string {
	if (typeof iso !== "string") return "never";
	const ms = now.getTime() - Date.parse(iso);
	if (!Number.isFinite(ms)) return "unknown";
	const s = Math.round(ms / 1000);
	if (s < 45) return "just now";
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const hrs = Math.round(m / 60);
	if (hrs < 24) return `${hrs} h ago`;
	const d = Math.round(hrs / 24);
	return d < 60 ? `${d} d ago` : iso.slice(0, 10);
}

/** A <time> element: relative text, the exact UTC time on hover. */
export const time = (iso: string | number | null | undefined, now: Date): Html =>
	typeof iso === "string"
		? h`<time datetime="${iso}" title="${iso.replace("T", " ").slice(0, 19)} UTC">${ago(iso, now)}</time>`
		: h`<span class="muted">never</span>`;

/** A number with thousands separators. */
export const count = (n: unknown): string => Number(n ?? 0).toLocaleString("en-US");
