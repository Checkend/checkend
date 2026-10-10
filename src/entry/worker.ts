import { cloudflarePorts } from "../adapters/cloudflare/ports.ts";
import { consumeIngest } from "../core/ingest/overflow.ts";
import { IngestState } from "../core/ingest/state.ts";
import { runScheduled } from "../core/scheduler.ts";
import { deliverDue } from "../core/webhooks.ts";
import { createApp } from "../http/app.ts";

// One app per isolate: it holds the in-memory caches and the D1 write state. The ingest queue
// consumer uses the same state.
const state = new IngestState();
const app = createApp({ state });

export default {
	fetch(request, env, ctx) {
		return app.fetch(request, { ports: cloudflarePorts(env, ctx) }, ctx);
	},
	// Two optional queues: NOTIFY (webhook deliveries: a message starts the due deliveries; the
	// cron retries as well) and INGEST_QUEUE (overflow events). Messages are routed by kind.
	async queue(batch, env, ctx) {
		const ports = cloudflarePorts(env, ctx);
		const messages = batch.messages as readonly Message<unknown>[];
		const ingest = messages.filter((m) => (m.body as { kind?: unknown })?.kind === "ingest");
		const others = messages.filter((m) => !ingest.includes(m));
		if (ingest.length > 0) await consumeIngest(ports, state, ingest);
		if (others.length > 0) {
			await deliverDue(ports);
			for (const message of others) message.ack();
		}
	},
	scheduled(controller, env, ctx) {
		const ports = cloudflarePorts(env, ctx);
		ctx.waitUntil(runScheduled(ports, new Date(controller.scheduledTime)));
	},
} satisfies ExportedHandler<Env>;
