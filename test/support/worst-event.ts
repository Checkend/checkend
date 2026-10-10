/**
 * The worst valid event for the CPU budget: every list at its limit (and above, so that the
 * limits must cut), long context lines, deep free-form data. Shaped like a Node SDK event.
 */
export function worstValidEvent(): Record<string, unknown> {
	const line =
		"    const result = await someService.performOperation(input, options, context);".padEnd(
			200,
			" ",
		);
	const frame = (i: number) => ({
		filename: `/srv/app/src/modules/module${i % 20}/handler${i}.ts`,
		module: `modules.module${i % 20}:handler${i}`,
		function: `Handler${i}.process`,
		lineno: 100 + i,
		colno: 15,
		in_app: i % 3 !== 0,
		pre_context: Array.from({ length: 7 }, () => line),
		context_line: line,
		post_context: Array.from({ length: 7 }, () => line),
	});
	const nested = (depth: number): unknown =>
		depth === 0 ? "leaf value with some text" : { a: nested(depth - 1), b: [1, 2, 3], c: "text" };
	return {
		event_id: "0123456789abcdef0123456789abcdef",
		timestamp: Date.now() / 1000,
		level: "error",
		platform: "node",
		release: "app@2.3.4",
		environment: "production",
		server_name: "web-1",
		exception: {
			values: Array.from({ length: 12 }, (_, e) => ({
				type: `Error${e}`,
				value: `Request ${e} failed with status 500 for user 12345 at https://api.example.com/v1/x`,
				stacktrace: { frames: Array.from({ length: 60 }, (_, i) => frame(i)) },
				mechanism: { type: "generic", handled: false },
			})),
		},
		breadcrumbs: Array.from({ length: 120 }, (_, i) => ({
			timestamp: Date.now() / 1000 - i,
			category: "http",
			message: `GET /api/items/${i} -> 200 Bearer abc.def.ghi password=secret`,
			data: { url: `/api/items/${i}?token=abc`, status_code: 200, nested: nested(3) },
		})),
		tags: Object.fromEntries(
			Array.from({ length: 60 }, (_, i) => [`tag${i}`, `value-${i}`.repeat(10)]),
		),
		user: { id: "user-1", email: "ada@example.com", ip_address: "10.0.0.1" },
		request: {
			url: "https://shop.example/checkout?session=abc&page=2",
			method: "POST",
			headers: Object.fromEntries(
				Array.from({ length: 60 }, (_, i) => [`X-Header-${i}`, "v".repeat(100)]),
			),
		},
		contexts: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`ctx${i}`, nested(5)])),
		extra: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`extra${i}`, nested(6)])),
	};
}

/**
 * The worst event that a Sentry SDK sends with its default limits: normalizeDepth 3,
 * maxValueLength 250, maxBreadcrumbs 100, 50 frames, 7 context lines, 5 linked errors.
 */
export function worstSdkEvent(): Record<string, unknown> {
	const line =
		"    const result = await someService.performOperation(input, options, context);".padEnd(
			120,
			" ",
		);
	const value = "v".repeat(250);
	const depth3 = { a: { b: { c: value } }, list: [value, value, value] };
	const frame = (i: number) => ({
		filename: `/srv/app/src/modules/module${i % 20}/handler${i}.ts`,
		module: `modules.module${i % 20}:handler${i}`,
		function: `Handler${i}.process`,
		lineno: 100 + i,
		colno: 15,
		in_app: i % 2 === 0,
		pre_context: Array.from({ length: 7 }, () => line),
		context_line: line,
		post_context: Array.from({ length: 7 }, () => line),
	});
	return {
		event_id: "0123456789abcdef0123456789abcdef",
		timestamp: Date.now() / 1000,
		level: "error",
		platform: "node",
		release: "app@2.3.4",
		environment: "production",
		exception: {
			values: Array.from({ length: 6 }, (_, e) => ({
				type: `Error${e}`,
				value: value,
				stacktrace: { frames: Array.from({ length: 50 }, (_, i) => frame(i)) },
				mechanism: { type: "generic", handled: false },
			})),
		},
		breadcrumbs: Array.from({ length: 100 }, (_, i) => ({
			timestamp: Date.now() / 1000 - i,
			category: "http",
			message: `GET /api/items/${i} -> 200`,
			data: { url: `/api/items/${i}`, status_code: 200, body: value },
		})),
		tags: Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`tag${i}`, `value-${i}`])),
		user: { id: "user-1", email: "ada@example.com", ip_address: "10.0.0.1" },
		request: {
			url: "https://shop.example/checkout",
			method: "POST",
			headers: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`X-Header-${i}`, value])),
		},
		contexts: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`ctx${i}`, depth3])),
		extra: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`extra${i}`, depth3])),
	};
}

/** The largest event that ingest accepts: worstValidEvent() cut to just under 1 MB of JSON. */
export function maxSizeEvent(maxBytes: number): Record<string, unknown> {
	const event = worstValidEvent() as Record<string, Record<string, unknown> | unknown[]>;
	const size = () => new TextEncoder().encode(JSON.stringify(event)).byteLength;
	const contexts = event.contexts as Record<string, unknown>;
	const extra = event.extra as Record<string, unknown>;
	for (const key of Object.keys(extra)) {
		if (size() <= maxBytes) break;
		delete extra[key];
	}
	for (const key of Object.keys(contexts)) {
		if (size() <= maxBytes) break;
		delete contexts[key];
	}
	const values = (event.exception as { values: unknown[] }).values;
	while (size() > maxBytes && values.length > 1) values.pop();
	return event;
}
