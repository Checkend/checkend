import * as v from "valibot";
import type { JsonObject } from "./json.ts";

/**
 * Untrusted input, layer 2: the event shape (Valibot schemas) and the normalization limits.
 * A field with a wrong type is dropped; the event is kept. The result is the event that
 * Checkend stores for display and grouping. The raw payload is kept separately.
 */
export const EVENT_LIMITS = {
	message: 8192,
	shortString: 256,
	string: 1024,
	url: 2048,
	exceptions: 10,
	frames: 50,
	contextLines: 5,
	breadcrumbs: 50,
	tags: 50,
	tagValue: 200,
	depth: 4,
	objectKeys: 50,
	arrayItems: 50,
	fingerprintParts: 16,
	/** Upper bound for the stored JSON, well below the D1 row limit (2 MB). */
	jsonBytes: 64 * 1024,
	maxAgeMs: 30 * 24 * 3600 * 1000,
	maxSkewMs: 60 * 1000,
} as const;

export type Level = "fatal" | "error" | "warning" | "info" | "debug";

export interface NormalizedFrame {
	filename: string | null;
	abs_path: string | null;
	module: string | null;
	function: string | null;
	lineno: number | null;
	colno: number | null;
	in_app: boolean | null;
	context_line: string | null;
	pre_context: string[];
	post_context: string[];
}

export interface NormalizedException {
	/** Null when the SDK sends none (for example a synthetic exception of captureMessage). */
	type: string | null;
	value: string;
	module: string | null;
	/** `synthetic`: the SDK made the stack trace for a message; it is not a real error. */
	mechanism: { type: string | null; handled: boolean | null; synthetic: boolean } | null;
	/** Oldest call first; the frame that raised the error is last (Sentry order). */
	frames: NormalizedFrame[];
}

export interface NormalizedBreadcrumb {
	timestamp: string | null;
	type: string | null;
	category: string | null;
	level: string | null;
	message: string | null;
	data: unknown;
}

export interface NormalizedEvent {
	version: 1;
	event_id: string;
	timestamp: string;
	level: Level;
	platform: string | null;
	release: string | null;
	environment: string | null;
	server_name: string | null;
	/** The formatted message (captureMessage or logentry). */
	message: string | null;
	/** The message template before parameters, when the SDK sends one. Best for grouping. */
	message_template: string | null;
	/** Cause first; the error that was raised last (Sentry order). */
	exceptions: NormalizedException[];
	tags: [string, string][];
	user: Record<string, unknown> | null;
	request: {
		url: string | null;
		method: string | null;
		query_string: string | null;
		headers: [string, string][];
	} | null;
	contexts: Record<string, unknown> | null;
	extra: Record<string, unknown> | null;
	breadcrumbs: NormalizedBreadcrumb[];
	sdk: { name: string | null; version: string | null } | null;
	fingerprint: string[] | null;
	/** True when parts were removed to keep the stored JSON under the size limit. */
	truncated: boolean;
}

// --- schemas ---------------------------------------------------------------------------

const opt = <T extends v.GenericSchema>(schema: T) => v.fallback(v.optional(schema), undefined);
const str = opt(v.string());
const num = opt(v.pipe(v.number(), v.finite()));
const bool = opt(v.boolean());
const list = opt(v.array(v.unknown()));
const record = opt(v.record(v.string(), v.unknown()));

const FrameSchema = v.looseObject({
	filename: str,
	abs_path: str,
	module: str,
	function: str,
	lineno: num,
	colno: num,
	in_app: bool,
	context_line: str,
	pre_context: opt(v.array(v.string())),
	post_context: opt(v.array(v.string())),
});

const ExceptionSchema = v.looseObject({
	type: str,
	value: str,
	module: str,
	mechanism: opt(v.looseObject({ type: str, handled: bool, synthetic: bool })),
	stacktrace: opt(v.looseObject({ frames: list })),
});

const BreadcrumbSchema = v.looseObject({
	timestamp: opt(v.union([v.number(), v.string()])),
	type: str,
	category: str,
	level: str,
	message: str,
	data: v.optional(v.unknown()),
});

const EventSchema = v.looseObject({
	event_id: str,
	timestamp: opt(v.union([v.number(), v.string()])),
	level: str,
	platform: str,
	release: str,
	environment: str,
	server_name: str,
	message: opt(v.union([v.string(), v.looseObject({ formatted: str, message: str })])),
	logentry: opt(v.looseObject({ formatted: str, message: str })),
	// Arrays first: an object schema also accepts an array.
	exception: opt(v.union([v.array(v.unknown()), v.looseObject({ values: list })])),
	tags: opt(v.union([v.array(v.unknown()), v.record(v.string(), v.unknown())])),
	user: record,
	request: opt(
		v.looseObject({
			url: str,
			method: str,
			query_string: opt(v.union([v.string(), v.record(v.string(), v.unknown())])),
			headers: opt(v.union([v.array(v.unknown()), v.record(v.string(), v.unknown())])),
		}),
	),
	contexts: record,
	extra: record,
	breadcrumbs: opt(v.union([v.array(v.unknown()), v.looseObject({ values: list })])),
	sdk: opt(v.looseObject({ name: str, version: str })),
	fingerprint: opt(v.array(v.string())),
});

const parse = <T extends v.GenericSchema>(
	schema: T,
	value: unknown,
): v.InferOutput<T> | undefined => {
	const result = v.safeParse(schema, value);
	return result.success ? result.output : undefined;
};

// --- text ------------------------------------------------------------------------------

// Control characters (except tab, newline, carriage return), bidi controls, zero-width
// characters and the byte order mark. They hide or reorder text for a human or a model.
const INVISIBLE =
	// biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the purpose.
	/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Cleans untrusted text and truncates it to `max` characters (the last one is "…"). */
export function cleanText(value: string, max: number): string {
	const head = value.length > max * 2 ? value.slice(0, max * 2) : value;
	const clean = head.toWellFormed().replace(INVISIBLE, "");
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const text = (value: string | undefined, max: number = EVENT_LIMITS.string): string | null =>
	value === undefined ? null : cleanText(value, max);

/** Free-form data (contexts, extra, user, breadcrumb data): depth, keys, items, strings. */
function limitValue(value: unknown, depth: number = EVENT_LIMITS.depth): unknown {
	if (typeof value === "string") return cleanText(value, EVENT_LIMITS.string);
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "boolean" || value === null) return value;
	if (typeof value !== "object") return null;
	if (depth <= 0) return "[…]";
	if (Array.isArray(value)) {
		return value.slice(0, EVENT_LIMITS.arrayItems).map((item) => limitValue(item, depth - 1));
	}
	const out: Record<string, unknown> = {};
	let keys = 0;
	for (const [key, item] of Object.entries(value)) {
		if (keys++ >= EVENT_LIMITS.objectKeys) break;
		out[cleanText(key, 64)] = limitValue(item, depth - 1);
	}
	return out;
}

const limitRecord = (value: Record<string, unknown> | undefined) =>
	value === undefined ? null : (limitValue(value) as Record<string, unknown>);

// --- fields ----------------------------------------------------------------------------

const LEVELS = new Set<Level>(["fatal", "error", "warning", "info", "debug"]);

function eventId(value: string | undefined): string {
	const id = value?.replace(/-/g, "").toLowerCase();
	return id && /^[0-9a-f]{32}$/.test(id) ? id : crypto.randomUUID().replace(/-/g, "");
}

function toTime(value: number | string | undefined): number | null {
	if (value === undefined) return null;
	const ms =
		typeof value === "number"
			? value * 1000
			: /^\d+(\.\d+)?$/.test(value)
				? Number(value) * 1000
				: Date.parse(value);
	return Number.isFinite(ms) && ms > 0 ? ms : null;
}

function clampTime(value: number | string | undefined, received: Date): string {
	const ms = toTime(value);
	const now = received.getTime();
	if (ms === null || ms > now + EVENT_LIMITS.maxSkewMs || ms < now - EVENT_LIMITS.maxAgeMs) {
		return received.toISOString();
	}
	return new Date(ms).toISOString();
}

function frame(value: unknown): NormalizedFrame | null {
	const f = parse(FrameSchema, value);
	if (!f) return null;
	const lines = (lines: string[] | undefined, fromEnd: boolean) =>
		(fromEnd
			? (lines ?? []).slice(-EVENT_LIMITS.contextLines)
			: (lines ?? []).slice(0, EVENT_LIMITS.contextLines)
		).map((line) => cleanText(line, EVENT_LIMITS.shortString));
	return {
		filename: text(f.filename, EVENT_LIMITS.shortString * 2),
		abs_path: text(f.abs_path, EVENT_LIMITS.url),
		module: text(f.module, EVENT_LIMITS.shortString),
		function: text(f.function, EVENT_LIMITS.shortString),
		lineno: f.lineno ?? null,
		colno: f.colno ?? null,
		in_app: f.in_app ?? null,
		context_line: text(f.context_line, EVENT_LIMITS.shortString),
		pre_context: lines(f.pre_context, true),
		post_context: lines(f.post_context, false),
	};
}

function exception(value: unknown): NormalizedException | null {
	const e = parse(ExceptionSchema, value);
	if (!e) return null;
	const frames = (e.stacktrace?.frames ?? [])
		.slice(-EVENT_LIMITS.frames * 4)
		.map(frame)
		.filter((f): f is NormalizedFrame => f !== null)
		.slice(-EVENT_LIMITS.frames);
	return {
		type: text(e.type, EVENT_LIMITS.shortString),
		value: cleanText(e.value ?? "", EVENT_LIMITS.message),
		module: text(e.module, EVENT_LIMITS.shortString),
		mechanism: e.mechanism
			? {
					type: text(e.mechanism.type, EVENT_LIMITS.shortString),
					handled: e.mechanism.handled ?? null,
					synthetic: e.mechanism.synthetic ?? false,
				}
			: null,
		frames,
	};
}

const TAG_KEY = /^[A-Za-z0-9_.:-]{1,32}$/;

function tags(value: Record<string, unknown> | unknown[] | undefined): [string, string][] {
	if (value === undefined) return [];
	const pairs: [unknown, unknown][] = Array.isArray(value)
		? value.filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
		: Object.entries(value);
	const out: [string, string][] = [];
	for (const [key, raw] of pairs) {
		if (out.length >= EVENT_LIMITS.tags) break;
		if (typeof key !== "string" || !TAG_KEY.test(key)) continue;
		if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
		out.push([key, cleanText(String(raw), EVENT_LIMITS.tagValue)]);
	}
	return out;
}

function headers(value: Record<string, unknown> | unknown[] | undefined): [string, string][] {
	if (value === undefined) return [];
	const pairs: [unknown, unknown][] = Array.isArray(value)
		? value.filter((p): p is [unknown, unknown] => Array.isArray(p) && p.length === 2)
		: Object.entries(value);
	return pairs
		.filter((p): p is [string, string] => typeof p[0] === "string" && typeof p[1] === "string")
		.slice(0, EVENT_LIMITS.objectKeys)
		.map(([k, val]) => [cleanText(k, 64), cleanText(val, EVENT_LIMITS.string)]);
}

function breadcrumb(value: unknown): NormalizedBreadcrumb | null {
	const b = parse(BreadcrumbSchema, value);
	if (!b) return null;
	const ms = toTime(b.timestamp);
	return {
		timestamp: ms === null ? null : new Date(ms).toISOString(),
		type: text(b.type, 64),
		category: text(b.category, 64),
		level: text(b.level, 16),
		message: text(b.message, EVENT_LIMITS.string),
		data: b.data === undefined ? null : limitValue(b.data, 2),
	};
}

// --- event -----------------------------------------------------------------------------

export function normalizeEvent(raw: JsonObject, received: Date): NormalizedEvent {
	const e = parse(EventSchema, raw) ?? ({} as v.InferOutput<typeof EventSchema>);

	const messageObject = typeof e.message === "object" ? e.message : undefined;
	const message =
		e.logentry?.formatted ??
		messageObject?.formatted ??
		(typeof e.message === "string" ? e.message : undefined) ??
		e.logentry?.message ??
		messageObject?.message;
	const template = e.logentry?.message ?? messageObject?.message;

	const exceptionValues = Array.isArray(e.exception) ? e.exception : (e.exception?.values ?? []);
	const breadcrumbValues = Array.isArray(e.breadcrumbs)
		? e.breadcrumbs
		: (e.breadcrumbs?.values ?? []);
	const level = (e.level?.toLowerCase() ?? "error") as Level;

	const event: NormalizedEvent = {
		version: 1,
		event_id: eventId(e.event_id),
		timestamp: clampTime(e.timestamp, received),
		level: LEVELS.has(level) ? level : "error",
		platform: text(e.platform, 32),
		release: text(e.release, 200),
		environment: text(e.environment, 200),
		server_name: text(e.server_name, 200),
		message: text(message, EVENT_LIMITS.message),
		message_template: text(template, EVENT_LIMITS.message),
		exceptions: exceptionValues
			.slice(-EVENT_LIMITS.exceptions)
			.map(exception)
			.filter((x): x is NormalizedException => x !== null),
		tags: tags(e.tags),
		user: limitRecord(e.user),
		request: e.request
			? {
					url: text(e.request.url, EVENT_LIMITS.url),
					method: text(e.request.method, 16),
					query_string:
						typeof e.request.query_string === "string"
							? cleanText(e.request.query_string, EVENT_LIMITS.url)
							: null,
					headers: headers(e.request.headers),
				}
			: null,
		contexts: limitRecord(e.contexts),
		extra: limitRecord(e.extra),
		breadcrumbs: breadcrumbValues
			.slice(-EVENT_LIMITS.breadcrumbs)
			.map(breadcrumb)
			.filter((b): b is NormalizedBreadcrumb => b !== null),
		sdk: e.sdk ? { name: text(e.sdk.name, 64), version: text(e.sdk.version, 32) } : null,
		fingerprint: e.fingerprint
			? e.fingerprint
					.slice(0, EVENT_LIMITS.fingerprintParts)
					.map((p) => cleanText(p, EVENT_LIMITS.shortString))
			: null,
		truncated: false,
	};
	return fitSize(event);
}

const encoder = new TextEncoder();
const size = (event: NormalizedEvent) => encoder.encode(JSON.stringify(event)).byteLength;

// Removes the least useful parts first until the JSON fits the size limit.
const SHRINK: ((event: NormalizedEvent) => void)[] = [
	(e) => {
		for (const b of e.breadcrumbs) b.data = null;
	},
	(e) => {
		e.breadcrumbs = e.breadcrumbs.slice(-10);
	},
	(e) => {
		e.extra = null;
	},
	(e) => {
		e.contexts = null;
	},
	(e) => {
		e.breadcrumbs = [];
	},
	(e) => {
		if (e.request) e.request.headers = [];
		e.user = e.user ? { id: e.user.id ?? null } : null;
	},
	(e) => {
		for (const x of e.exceptions) {
			for (const f of x.frames) {
				f.pre_context = [];
				f.post_context = [];
			}
		}
	},
	(e) => {
		e.message = e.message && cleanText(e.message, EVENT_LIMITS.string);
		for (const x of e.exceptions) {
			x.value = cleanText(x.value, EVENT_LIMITS.string);
			x.frames = x.frames.slice(-10);
		}
		e.exceptions = e.exceptions.slice(-3);
	},
];

function fitSize(event: NormalizedEvent): NormalizedEvent {
	for (const step of SHRINK) {
		if (size(event) <= EVENT_LIMITS.jsonBytes) return event;
		step(event);
		event.truncated = true;
	}
	return event;
}
