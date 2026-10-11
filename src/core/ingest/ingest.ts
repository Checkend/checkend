import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { startDeliveries } from "../webhooks.ts";
import { isValidKey, parseDsn, sentryKeyFromRequest } from "./auth.ts";
import { readIngestBody } from "./body.ts";
import { parseEnvelope } from "./envelope.ts";
import { IngestError } from "./errors.ts";
import { parseJson } from "./json.ts";
import { INGEST_LIMITS } from "./limits.ts";
import { nativeToSentry } from "./native.ts";
import { enqueueEvent } from "./overflow.ts";
import { prepareEvent } from "./prepare.ts";
import type { IngestState } from "./state.ts";
import { storeEvent } from "./store.ts";

/** envelope and store: the Sentry protocol. native: POST /v1/ingest (simple JSON). */
export type IngestKind = "envelope" | "store" | "native";

const RATE_LIMIT_SECONDS = 60;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...headers },
	});

const tooManyRequests = (seconds: number, scope: "key" | "organization", reason?: string) =>
	json(
		429,
		{
			detail: reason
				? "The daily quota of this project is used up."
				: "Too many requests. Retry later.",
		},
		{
			"retry-after": String(seconds),
			"x-sentry-rate-limits": `${seconds}::${scope}${reason ? `:${reason}` : ""}`,
		},
	);

/**
 * The Sentry ingest endpoints. All untrusted-input checks are here, in this order (the first
 * layer of the defence against hostile input): project ID, DSN key, rate limit, D1 state, then the body (type, encoding, size).
 * The write runs after the response, in `defer`.
 */
export async function handleIngest(
	request: Request,
	kind: IngestKind,
	projectParamInput: string,
	ports: Ports,
	state: IngestState,
): Promise<Response> {
	let projectParam = projectParamInput;
	try {
		// A D1 key lookup (cache miss), a slug lookup and the tunnel path cost work before
		// authentication, so they are rate-limited per client IP first.
		const client = ports.clientIp(request);
		const lookupAllowed = () => ports.rateLimiter.allow(`key-lookup:${client}`);
		const invalidKey = () => new IngestError(401, "invalid_key", "Invalid or missing DSN key.");

		if (kind === "native") {
			// ?project= is a public ID or a slug. An unknown project gives the same 401 as a
			// wrong key, so that the response does not show which projects exist.
			if (/^[a-z0-9][a-z0-9-]{0,47}$/.test(projectParam) && !/^\d{10}$/.test(projectParam)) {
				if (!(await lookupAllowed())) return tooManyRequests(RATE_LIMIT_SECONDS, "key");
				const found = await ports.db.first<{ public_id: number }>(
					sql`SELECT public_id FROM projects WHERE slug = ${projectParam}`,
				);
				if (!found) throw invalidKey();
				projectParam = String(found.public_id);
			}
			if (!/^\d{10}$/.test(projectParam)) throw invalidKey();
		}
		if (!/^\d{1,10}$/.test(projectParam)) return json(404, { detail: "Unknown project." });
		const projectId = Number(projectParam);
		const now = ports.clock.now();

		// The native endpoint reads the key only from X-Checkend-Key: never from the query
		// string (it ends up in logs), and never a bearer token (an ingest key gives no reads).
		let key =
			kind === "native"
				? (request.headers.get("x-checkend-key")?.trim().toLowerCase() ?? null)
				: sentryKeyFromRequest(request);
		let body: Uint8Array | null = null;
		if (key === null && kind === "envelope") {
			if (!(await lookupAllowed())) return tooManyRequests(RATE_LIMIT_SECONDS, "key");
			// Tunnels send the DSN only in the envelope header. Read the body (with caps) first.
			body = await readIngestBody(request);
			const dsn = parseDsn(parseEnvelope(body).header.dsn);
			if (dsn && dsn.projectId === projectParam) key = dsn.key;
		}
		if (!isValidKey(key)) throw invalidKey();
		if (state.keys.peek(projectId, key, now) === undefined && !(await lookupAllowed())) {
			return tooManyRequests(RATE_LIMIT_SECONDS, "key");
		}
		// The URL has the public project ID; the write needs the internal row ID.
		const project = await state.keys.find(ports.db, projectId, key, now);
		if (!project) throw invalidKey();
		// A browser sends an Origin header. A project can list the origins that it accepts.
		const origin = request.headers.get("origin");
		if (origin !== null && project.allowedOrigins?.includes(origin.toLowerCase()) === false) {
			throw new IngestError(403, "origin_not_allowed", "This origin cannot send events here.");
		}

		if (!(await ports.rateLimiter.allow(`${projectId}:${key}`))) {
			return tooManyRequests(RATE_LIMIT_SECONDS, "key");
		}
		// The daily quota of the project: until midnight UTC.
		if (
			project.dailyQuota !== null &&
			!(await state.quota.allow(ports.db, project.projectId, project.dailyQuota, now))
		) {
			const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
			return tooManyRequests(
				Math.ceil((midnight - now.getTime()) / 1000),
				"organization",
				"quota_exceeded",
			);
		}
		// D1 is overloaded: 429, unless the overflow queue can take the event (below).
		const overload = state.health.snapshot(now).retryAfterSeconds;
		if (overload > 0 && !ports.ingestQueue) return tooManyRequests(overload, "organization");

		body ??= await readIngestBody(request);
		const envelope = kind === "envelope" ? parseEnvelope(body) : null;
		const payload =
			kind === "native"
				? new TextEncoder().encode(JSON.stringify(nativeToSentry(parseJson(body))))
				: kind === "store"
					? body
					: (envelope?.event ?? null);
		if (!payload) return json(200, {}); // sessions, client reports, ...: dropped
		if (payload.byteLength > INGEST_LIMITS.eventBytes) {
			throw new IngestError(413, "event_too_large", "The event is larger than 1 MB.");
		}

		// Some SDKs (PHP) put the event_id only in the envelope header.
		const headerId = envelope?.header.event_id;
		const prepared = await prepareEvent(
			payload,
			now,
			typeof headerId === "string" ? headerId : null,
			project.scrub,
		);
		const browser = origin !== null;
		if (overload > 0) {
			if (!(await enqueueEvent(ports, project.projectId, prepared, browser))) {
				return tooManyRequests(overload, "organization");
			}
			return json(200, { id: prepared.event.event_id });
		}
		ports.defer(
			storeEvent(ports, state, project.projectId, prepared, { browser }).then(async (result) => {
				// A write that failed after its retries goes to the overflow queue, when there is one.
				if (result.outcome === "failed")
					await enqueueEvent(ports, project.projectId, prepared, browser);
				if (result.deliveries > 0) await startDeliveries(ports);
			}),
		);
		return json(200, { id: prepared.event.event_id });
	} catch (error) {
		if (error instanceof IngestError) return json(error.status, { detail: error.message });
		throw error;
	}
}
