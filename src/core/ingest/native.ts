import * as v from "valibot";
import { IngestError } from "./errors.ts";
import type { JsonObject } from "./json.ts";

/**
 * The native JSON ingest format (POST /v1/ingest): a simple shape for curl, scripts and
 * languages without a Sentry SDK. It becomes a Sentry-shaped event, so it goes through the
 * same scrubbing, normalization, limits and grouping as Sentry ingest.
 *
 * Frames are listed with the frame that raised the error first (the order of most printed
 * stack traces). Sentry events list it last, so the conversion reverses them.
 */
const text = (max: number) => v.optional(v.pipe(v.string(), v.maxLength(max)));

const NativeFrame = v.object({
	file: text(2048),
	function: text(1024),
	module: text(1024),
	line: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	column: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
	in_app: v.optional(v.boolean()),
	context: v.optional(
		v.object({
			pre: v.optional(v.pipe(v.array(v.string()), v.maxLength(20))),
			line: text(4096),
			post: v.optional(v.pipe(v.array(v.string()), v.maxLength(20))),
		}),
	),
});

export const NativeEvent = v.pipe(
	v.object({
		event_id: text(64),
		type: text(1024),
		message: text(65536),
		level: v.optional(v.picklist(["fatal", "error", "warning", "info", "debug"])),
		timestamp: v.optional(v.union([v.string(), v.number()])),
		release: text(1024),
		environment: text(1024),
		platform: text(64),
		server_name: text(1024),
		frames: v.optional(v.pipe(v.array(NativeFrame), v.maxLength(1000))),
		tags: v.optional(v.record(v.string(), v.union([v.string(), v.number(), v.boolean()]))),
		user: v.optional(v.record(v.string(), v.unknown())),
		request: v.optional(
			v.object({
				method: text(16),
				url: text(8192),
				headers: v.optional(v.record(v.string(), v.string())),
			}),
		),
		extra: v.optional(v.record(v.string(), v.unknown())),
		fingerprint: v.optional(v.pipe(v.array(v.string()), v.maxLength(16))),
	}),
	v.check((e) => e.type !== undefined || e.message !== undefined, "Give a type or a message."),
);
export type NativeEvent = v.InferOutput<typeof NativeEvent>;

/** Validates a native event and converts it to the Sentry event shape. */
export function nativeToSentry(input: JsonObject): JsonObject {
	const parsed = v.safeParse(NativeEvent, input);
	if (!parsed.success) {
		const issue = parsed.issues[0];
		const path = issue ? v.getDotPath(issue) : null;
		throw new IngestError(
			400,
			"invalid_event",
			`${path ? `${path}: ` : ""}${issue?.message ?? "Invalid event."}`,
		);
	}
	const e = parsed.output;
	const frames = (e.frames ?? [])
		.map((f) => ({
			filename: f.file,
			function: f.function,
			module: f.module,
			lineno: f.line,
			colno: f.column,
			in_app: f.in_app,
			pre_context: f.context?.pre,
			context_line: f.context?.line,
			post_context: f.context?.post,
		}))
		.reverse();
	const event: JsonObject = {
		event_id: e.event_id,
		level: e.level,
		timestamp: e.timestamp,
		release: e.release,
		environment: e.environment,
		platform: e.platform ?? "other",
		server_name: e.server_name,
		tags: e.tags,
		user: e.user,
		request: e.request,
		extra: e.extra,
		fingerprint: e.fingerprint,
	};
	if (e.type !== undefined) {
		event.exception = {
			values: [{ type: e.type, value: e.message ?? "", stacktrace: { frames } }],
		};
	} else {
		event.message = e.message;
	}
	return event;
}
