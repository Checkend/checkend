import type { Ports } from "../../ports/index.ts";
import { isValidKey, parseDsn, sentryKeyFromRequest } from "./auth.ts";
import { readIngestBody } from "./body.ts";
import { parseEnvelope } from "./envelope.ts";
import { IngestError } from "./errors.ts";
import { prepareEvent } from "./prepare.ts";
import type { IngestState } from "./state.ts";
import { storeEvent } from "./store.ts";

export type IngestKind = "envelope" | "store";

const RATE_LIMIT_SECONDS = 60;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const tooManyRequests = (seconds: number, scope: "key" | "organization") =>
	json(
		429,
		{ detail: "Too many requests. Retry later." },
		{ "retry-after": String(seconds), "x-sentry-rate-limits": `${seconds}::${scope}` },
	);

/**
 * The Sentry ingest endpoints. All untrusted-input checks are here, in this order (H2
 * layer 1): project ID, DSN key, rate limit, D1 state, then the body (type, encoding, size).
 * The write runs after the response, in `defer`.
 */
export async function handleIngest(
	request: Request,
	kind: IngestKind,
	projectParam: string,
	ports: Ports,
	state: IngestState,
): Promise<Response> {
	try {
		if (!/^\d{1,10}$/.test(projectParam)) return json(404, { detail: "Unknown project." });
		const projectId = Number(projectParam);
		const now = ports.clock.now();

		let key = sentryKeyFromRequest(request);
		let body: Uint8Array | null = null;
		if (key === null && kind === "envelope") {
			// Tunnels send the DSN only in the envelope header. Read the body (with caps) first.
			body = await readIngestBody(request);
			const dsn = parseDsn(parseEnvelope(body).header.dsn);
			if (dsn && dsn.projectId === projectParam) key = dsn.key;
		}
		if (!isValidKey(key) || !(await state.keys.find(ports.db, projectId, key, now))) {
			throw new IngestError(401, "invalid_key", "Invalid or missing DSN key.");
		}

		if (!(await ports.rateLimiter.allow(`${projectId}:${key}`))) {
			return tooManyRequests(RATE_LIMIT_SECONDS, "key");
		}
		const overload = state.health.snapshot(now).retryAfterSeconds;
		if (overload > 0) return tooManyRequests(overload, "organization");

		body ??= await readIngestBody(request);
		const payload = kind === "store" ? body : parseEnvelope(body).event;
		if (!payload) return json(200, {}); // sessions, client reports, ...: dropped

		const prepared = await prepareEvent(payload, now);
		ports.defer(storeEvent(ports, state, projectId, prepared));
		return json(200, { id: prepared.event.event_id });
	} catch (error) {
		if (error instanceof IngestError) return json(error.status, { detail: error.message });
		throw error;
	}
}
