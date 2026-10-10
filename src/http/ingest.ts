import type { Hono } from "hono";
import { handleIngest, type IngestKind } from "../core/ingest/ingest.ts";
import type { IngestState } from "../core/ingest/state.ts";
import type { AppEnv } from "./app.ts";

// Browser SDKs post from other origins. The DSN key is public, so any origin is allowed.
const CORS = {
	"access-control-allow-origin": "*",
	"access-control-expose-headers": "x-sentry-rate-limits, retry-after",
};
const PREFLIGHT = {
	...CORS,
	"access-control-allow-methods": "POST, OPTIONS",
	"access-control-allow-headers": "content-type, content-encoding, x-sentry-auth",
	"access-control-max-age": "86400",
};

export function ingestRoutes(app: Hono<AppEnv>, state: IngestState): void {
	// Native JSON ingest. Before the /v1 bearer auth: it uses the DSN key (X-Checkend-Key).
	// No CORS: browsers use the Sentry endpoints.
	app.post("/v1/ingest", (c) =>
		handleIngest(c.req.raw, "native", c.req.query("project") ?? "", c.env.ports, state),
	);

	for (const kind of ["envelope", "store"] satisfies IngestKind[]) {
		for (const path of [`/api/:project/${kind}/`, `/api/:project/${kind}`]) {
			app.options(path, () => new Response(null, { status: 204, headers: PREFLIGHT }));
			app.post(path, async (c) => {
				const response = await handleIngest(
					c.req.raw,
					kind,
					c.req.param("project") ?? "",
					c.env.ports,
					state,
				);
				for (const [name, value] of Object.entries(CORS)) response.headers.set(name, value);
				return response;
			});
		}
	}
}
