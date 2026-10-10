import { cloudflarePorts } from "../adapters/cloudflare/ports.ts";
import { runScheduled } from "../core/scheduler.ts";
import { createApp } from "../http/app.ts";

// One app per isolate: it holds the in-memory caches and the D1 write state.
const app = createApp();

export default {
	fetch(request, env, ctx) {
		return app.fetch(request, { ports: cloudflarePorts(env, ctx) }, ctx);
	},
	// One Cron Trigger; runScheduled decides which jobs run (H3).
	scheduled(controller, env, ctx) {
		const ports = cloudflarePorts(env, ctx);
		ctx.waitUntil(runScheduled(ports, new Date(controller.scheduledTime)));
	},
} satisfies ExportedHandler<Env>;
