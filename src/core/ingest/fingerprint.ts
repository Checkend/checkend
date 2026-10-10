import {
	cleanText,
	type NormalizedEvent,
	type NormalizedException,
	type NormalizedFrame,
} from "./normalize.ts";

/**
 * Grouping, version 1. A change to these rules splits existing issues, so it needs a new
 * version and a migration (AGENTS.md, "Version what can change"). The fixture snapshot test
 * fails when the result changes.
 *
 * Order of rules:
 * 1. The SDK `fingerprint`, with `{{ default }}` replaced by the default components.
 * 2. Exception types + in-app frames (module or normalized file name + function).
 *    No line numbers, so a deploy does not create new issues.
 * 3. Type + normalized message, when no frame is usable (for example only minified names).
 * 4. The normalized message (message events; a synthetic stack is ignored).
 */
export const FINGERPRINT_VERSION = 1;

export type FingerprintMethod = "sdk" | "stack" | "message";

export interface Fingerprint {
	version: typeof FINGERPRINT_VERSION;
	hash: string;
	method: FingerprintMethod;
	components: string[];
}

const MESSAGE_RULES: [RegExp, string][] = [
	[/\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)]+/gi, "<url>"],
	[/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, "<email>"],
	[/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
	[/\b\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g, "<date>"],
	[/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>"],
	[/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, "<hex>"],
	[/'[^'\n]{0,200}'|"[^"\n]{0,200}"|`[^`\n]{0,200}`/g, "<str>"],
	[/\b\d+(\.\d+)?\b/g, "<num>"],
	[/\s+/g, " "],
];

/** Replaces values that change between occurrences (IDs, numbers, quoted values, ...). */
export function normalizeMessage(message: string): string {
	let out = message.slice(0, 2048);
	for (const [pattern, replacement] of MESSAGE_RULES) out = out.replace(pattern, replacement);
	return out.trim().slice(0, 512);
}

const BUNDLE_HASH = [
	/[.-][0-9a-f]{6,}(?=\.)/gi, // app.3f9a2c1b.js, main-4f2a9c8e1b.chunk.js
	/-(?=[A-Za-z0-9_]*\d|[A-Za-z0-9_]*[A-Z])(?=[A-Za-z0-9_]*[a-z])[A-Za-z0-9_]{8}(?=\.(?:m?js|css)$)/g, // Vite: index-B2xQ9kLm.js
];

/**
 * A file name without the parts that change between deploys: URL origin, query, fragment,
 * bundle hashes, and the deploy directory of an absolute path (the last 3 segments stay).
 */
export function normalizeFilename(filename: string): string {
	let name = filename.replace(/[?#].*$/, "");
	const url = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(name);
	if (/^webpack:\/\//.test(name)) name = name.replace(/^webpack:\/\/[^/]*\//, "");
	else if (url) name = url[1] ?? "/";
	name = name.replace(/^\.\//, "");
	for (const pattern of BUNDLE_HASH) name = name.replace(pattern, "");
	if (!url && name.startsWith("/")) name = name.split("/").slice(-3).join("/");
	return name;
}

const ANONYMOUS = new Set(["", "?", "<anonymous>", "anonymous"]);

function isBundled(filename: string): boolean {
	const plain = filename.replace(/[?#].*$/, "");
	return (
		/\.min\.js$/.test(plain) || BUNDLE_HASH.some((p) => new RegExp(p.source, p.flags).test(plain))
	);
}

/** The grouping key of a frame, or null when the frame is not usable for grouping. */
function frameKey(frame: NormalizedFrame): string | null {
	const file = frame.filename ?? frame.abs_path;
	const fn = frame.function && !ANONYMOUS.has(frame.function) ? frame.function : "";
	// Minified code: names like "r" or "Zt" change with every build.
	if (file && isBundled(file) && fn.length <= 3) return null;
	const location = frame.module ?? (file ? normalizeFilename(file) : null);
	if (!location && !fn) return null;
	return `${location ?? ""}:${fn || "?"}`;
}

function stackFrames(exception: NormalizedException): NormalizedFrame[] {
	const inApp = exception.frames.filter((f) => f.in_app === true);
	return inApp.length > 0 ? inApp : exception.frames;
}

const realExceptions = (event: NormalizedEvent) =>
	event.exceptions.filter((e) => !e.mechanism?.synthetic);

function defaultComponents(event: NormalizedEvent): {
	method: FingerprintMethod;
	components: string[];
} {
	const exceptions = realExceptions(event);
	if (exceptions.length > 0) {
		const components: string[] = [];
		let usable = 0;
		for (const exception of exceptions) {
			components.push(`type:${exception.type ?? ""}`);
			for (const frame of stackFrames(exception)) {
				const key = frameKey(frame);
				if (key) {
					components.push(key);
					usable++;
				}
			}
		}
		if (usable > 0) return { method: "stack", components };
		const raised = exceptions.at(-1) as NormalizedException;
		return {
			method: "message",
			components: [`type:${raised.type ?? ""}`, normalizeMessage(raised.value)],
		};
	}
	const message = event.message_template ?? event.message ?? event.exceptions.at(-1)?.value ?? "";
	return { method: "message", components: [normalizeMessage(message)] };
}

const DEFAULT_PLACEHOLDER = /^\{\{\s*default\s*\}\}$/;

export async function fingerprintEvent(event: NormalizedEvent): Promise<Fingerprint> {
	const fallback = defaultComponents(event);
	let { method, components } = fallback;
	if (event.fingerprint && event.fingerprint.length > 0) {
		method = "sdk";
		components = event.fingerprint.flatMap((part) =>
			DEFAULT_PLACEHOLDER.test(part) ? fallback.components : [part],
		);
	}
	const input = JSON.stringify({
		v: FINGERPRINT_VERSION,
		m: method === "sdk" ? "sdk" : "default",
		c: components,
	});
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
	const hash = [...new Uint8Array(digest)]
		.slice(0, 16)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
	return { version: FINGERPRINT_VERSION, hash, method, components };
}

export interface IssueTitle {
	title: string;
	type: string | null;
	culprit: string | null;
}

/** The title of a new issue: the raised error (type and value), or the message. */
export function issueTitle(event: NormalizedEvent): IssueTitle {
	const raised = realExceptions(event).at(-1);
	if (raised) {
		const type = raised.type ?? "Error";
		const title = raised.value ? `${type}: ${raised.value}` : type;
		const frames = stackFrames(raised);
		const frame = frames.at(-1);
		const where = frame?.module ?? (frame?.filename ? normalizeFilename(frame.filename) : null);
		const culprit = frame
			? `${frame.function && !ANONYMOUS.has(frame.function) ? frame.function : "?"}${where ? ` (${where})` : ""}`
			: null;
		return {
			title: cleanText(title, 200),
			type: raised.type,
			culprit: culprit && cleanText(culprit, 200),
		};
	}
	const message = event.message ?? event.exceptions.at(-1)?.value ?? "(no message)";
	return { title: cleanText(message || "(no message)", 200), type: null, culprit: null };
}
