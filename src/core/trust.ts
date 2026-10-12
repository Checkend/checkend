/**
 * Source trust: how much the event data of an app can be trusted, from where its events come.
 *
 * Server SDKs send events from the user's own servers, with a DSN that stays secret: high
 * trust. Browser, mobile and desktop SDKs send events from users' devices, with a DSN that
 * anyone can read and use: low trust. A client event marks its DSN key for good
 * (project_keys.client_marked_at): the key is public, and a quiet month does not make it secret
 * again. The app is low trust while an active key has the mark. Only a new key (rotation: add a
 * key, revoke the old one) or the admin setting (projects.trust, which wins) changes that. The
 * sources of the last 30 days only set the shown source (server, browser, mixed).
 *
 * The SDK name is untrusted input: anyone with a public DSN can send any name. So it can only
 * lower trust: an Origin header is always client, and an unknown or missing name is client.
 *
 * Every reader of the trust uses effectiveTrust() (JS) or EFFECTIVE_TRUST_SQL (the webhook
 * gate). test/node/source-trust.test.ts checks that they agree.
 */

export type Trust = "low" | "high";
/** The class of one event's source. */
export type SourceClass = "server" | "client";
/** The sources of an app in the last 30 days. "browser" also covers mobile and unknown SDKs. */
export type Source = "server" | "browser" | "mixed" | null;

/** A source class counts for this long in the shown source (never for the trust). */
export const TRUST_WINDOW_MS = 30 * 86_400_000;

/** The trust columns of a project row. */
export interface TrustColumns {
	trust: string | null;
	server_seen_at: string | null;
	client_seen_at: string | null;
	/** 1 when an active DSN key of the app has a client mark (CLIENT_MARKED_SQL). */
	client_marked: number | boolean;
}

/**
 * CLIENT_MARKED_SQL for a projects row with the given alias: 1 when an active key has a client
 * mark. SQL text from constants only (no values, no parameters).
 */
export const CLIENT_MARKED_SQL = (alias: "p" | "projects") =>
	`EXISTS (SELECT 1 FROM project_keys k WHERE k.project_id = ${alias}.id
		AND k.revoked_at IS NULL AND k.client_marked_at IS NOT NULL)`;

// Exact names (and integration suffixes where the whole SDK family runs on servers).
const SERVER_FAMILIES = ["sentry.python", "sentry.ruby", "sentry.php", "sentry.go"];
const SERVER_NAMES = new Set([
	"sentry.javascript.node",
	"sentry.javascript.bun",
	"sentry.javascript.deno",
	"sentry.javascript.aws-serverless",
	"sentry.javascript.google-cloud-serverless",
	"sentry.javascript.serverless",
	"sentry.javascript.nestjs",
	"sentry.javascript.cloudflare",
	"sentry.javascript.vercel-edge",
	"sentry.java",
	"sentry.java.spring",
	"sentry.java.spring.jakarta",
	"sentry.java.spring-boot",
	"sentry.java.spring-boot.jakarta",
	"sentry.java.log4j2",
	"sentry.java.logback",
	"sentry.java.jul",
	"sentry.dotnet",
	"sentry.dotnet.aspnetcore",
	"sentry.dotnet.aspnet",
	"sentry.dotnet.extensions.logging",
	"sentry.dotnet.serilog",
	"sentry.dotnet.nlog",
	"sentry.dotnet.log4net",
	"sentry.dotnet.azure.functions.worker",
	"sentry.dotnet.google.cloud.functions",
	"sentry.elixir",
	"sentry.rust",
	"sentry.perl",
]);
// One SDK name for the browser and the server part. A tunnel route sends browser events from
// the app's server with no Origin header, so the platform or the runtime of the event decides.
const SPLIT_NAMES = new Set([
	"sentry.javascript.nextjs",
	"sentry.javascript.sveltekit",
	"sentry.javascript.remix",
	"sentry.javascript.nuxt",
	"sentry.javascript.astro",
	"sentry.javascript.solidstart",
	"sentry.javascript.tanstackstart-react",
	"sentry.javascript.react-router",
]);

// The server runtimes of the split SDKs (contexts.runtime.name).
const SERVER_RUNTIMES = new Set(["node", "bun", "deno", "vercel-edge", "edge"]);

/**
 * The source class of one event. `origin`: the request had an Origin header (a browser).
 * `native`: POST /v1/ingest with X-Checkend-Key (scripts and servers; it has no SDK name).
 * `platform` and `runtime` (contexts.runtime.name) of the event: only for the split SDKs.
 */
export function classifySource(
	sdkName: string | null,
	{
		origin,
		native,
		platform = null,
		runtime = null,
	}: { origin: boolean; native: boolean; platform?: string | null; runtime?: string | null },
): SourceClass {
	if (origin) return "client";
	if (native) return "server";
	if (sdkName === null) return "client";
	if (SPLIT_NAMES.has(sdkName)) {
		const server = platform === "node" || (runtime !== null && SERVER_RUNTIMES.has(runtime));
		return server ? "server" : "client";
	}
	if (SERVER_NAMES.has(sdkName)) return "server";
	for (const family of SERVER_FAMILIES) {
		if (sdkName === family) return "server";
		// An integration of the family, for example sentry.python.django.
		const rest = sdkName.startsWith(`${family}.`) ? sdkName.slice(family.length + 1) : null;
		if (rest !== null && /^[a-z0-9_-]{1,32}$/.test(rest)) return "server";
	}
	return "client";
}

/** The oldest seen time that still counts at `now` (ISO). A seen time equal to it counts. */
export function trustCutoff(now: Date): string {
	return new Date(now.getTime() - TRUST_WINDOW_MS).toISOString();
}

const counts = (seenAt: string | null, cutoff: string) => seenAt !== null && seenAt >= cutoff;

/** The trust: the admin setting, or low when an active key has a client mark. No expiry. */
export function effectiveTrust(row: TrustColumns): Trust {
	if (row.trust === "low" || row.trust === "high") return row.trust;
	return row.client_marked === true || row.client_marked === 1 ? "low" : "high";
}

/** The sources that count now. */
export function sourceOf(row: TrustColumns, now: Date): Source {
	const cutoff = trustCutoff(now);
	const server = counts(row.server_seen_at, cutoff);
	const client = counts(row.client_seen_at, cutoff);
	if (server && client) return "mixed";
	if (client) return "browser";
	if (server) return "server";
	return null;
}

/**
 * effectiveTrust() in SQL, for a projects row with the given alias. It has no parameters.
 * SQL text from constants only (no values).
 */
export const EFFECTIVE_TRUST_SQL = (alias: "p" | "projects") =>
	`coalesce(${alias}.trust, CASE WHEN ${CLIENT_MARKED_SQL(alias)} THEN 'low' ELSE 'high' END)`;

/** The trust fields of the API (additive): trust, source_trust (always equal), source. */
export function trustFields(row: TrustColumns, now: Date) {
	const trust = effectiveTrust(row);
	return { trust, source_trust: trust, source: sourceOf(row, now) };
}
