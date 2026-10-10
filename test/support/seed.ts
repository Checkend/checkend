import { IngestState } from "../../src/core/ingest/state.ts";
import type { CreatedProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import type { TestPorts } from "./node-ports.ts";

let counter = 0;

/** A Node SDK-like error event. `type`, `value` and `fn` decide the issue (the fingerprint). */
export function errorEvent(
	options: {
		type?: string;
		value?: string;
		fn?: string;
		release?: string;
		environment?: string;
		tags?: Record<string, string>;
		extra?: Record<string, unknown>;
		request?: Record<string, unknown>;
	} = {},
): Record<string, unknown> {
	counter++;
	return {
		event_id: crypto.randomUUID().replace(/-/g, ""),
		level: "error",
		platform: "node",
		release: options.release ?? "shop@1.0.0",
		environment: options.environment ?? "production",
		tags: options.tags ?? { region: "us-east" },
		...(options.extra ? { extra: options.extra } : {}),
		...(options.request ? { request: options.request } : {}),
		exception: {
			values: [
				{
					type: options.type ?? "TypeError",
					value: options.value ?? `Cannot read properties of undefined (#${counter})`,
					stacktrace: {
						frames: [
							{
								filename: "node:internal/process/task_queues",
								function: "processTicksAndRejections",
								lineno: 95,
								in_app: false,
							},
							{
								filename: "/srv/app/src/checkout/total.ts",
								module: "checkout.total",
								function: options.fn ?? "computeTotal",
								lineno: 48,
								colno: 12,
								in_app: true,
								pre_context: ["export function computeTotal(cart) {", "  const list = cart.items;"],
								context_line: "  return money(cart.total, list.currency);",
								post_context: ["}"],
							},
						],
					},
				},
			],
		},
	};
}

/** Sends events through the real ingest path at the current test clock time. */
export async function send(
	t: TestPorts,
	project: CreatedProject,
	...events: Record<string, unknown>[]
): Promise<void> {
	const app = createApp({ state: new IngestState() });
	for (const event of events) {
		const response = await app.request(
			`https://checkend.test/api/${project.id}/envelope/?sentry_key=${project.publicKey}`,
			{ method: "POST", body: `{}\n{"type":"event"}\n${JSON.stringify(event)}\n` },
			{ ports: t.ports },
		);
		if (response.status !== 200) throw new Error(`ingest: ${response.status}`);
		await t.settle();
	}
}
