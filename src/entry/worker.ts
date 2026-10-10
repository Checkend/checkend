import { cloudflarePorts } from "../adapters/cloudflare/ports.ts";
import { createApp } from "../http/app.ts";

// One app per isolate: it holds the in-memory caches and the D1 write state.
const app = createApp();

export default {
	fetch(request, env, ctx) {
		return app.fetch(request, { ports: cloudflarePorts(env, ctx) }, ctx);
	},
} satisfies ExportedHandler<Env>;
