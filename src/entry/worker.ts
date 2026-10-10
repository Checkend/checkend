import { cloudflarePorts } from "../adapters/cloudflare/ports.ts";
import { createApp } from "../http/app.ts";

const app = createApp();

export default {
	fetch(request, env, ctx) {
		return app.fetch(request, { ports: cloudflarePorts(env) }, ctx);
	},
} satisfies ExportedHandler<Env>;
