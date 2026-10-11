/**
 * Source trust: how much the event data of an app can be trusted, from where its events come.
 *
 * Server SDKs send events from the user's own servers, with a DSN that stays secret: high
 * trust. Browser, mobile and desktop SDKs send events from users' devices, with a DSN that
 * anyone can read and use: low trust. The weakest source of the last 30 days sets the level,
 * and an admin setting (projects.trust) wins over it.
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

/** A source class counts for this long after its last event. */
export const TRUST_WINDOW_MS = 30 * 86_400_000;

/** The trust columns of a project row. */
export interface TrustColumns {
	trust: string | null;
	server_seen_at: string | null;
	client_seen_at: string | null;
}

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
// One SDK name for the browser and the server part: the Origin header decides.
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

/**
 * The source class of one event. `origin`: the request had an Origin header (a browser).
 * `native`: POST /v1/ingest with X-Checkend-Key (scripts and servers; it has no SDK name).
 */
export function classifySource(
	sdkName: string | null,
	{ origin, native }: { origin: boolean; native: boolean },
): SourceClass {
	if (origin) return "client";
	if (native) return "server";
	if (sdkName === null) return "client";
	if (SERVER_NAMES.has(sdkName) || SPLIT_NAMES.has(sdkName)) return "server";
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

/** The trust now: the admin setting, or low when a client source counts. */
export function effectiveTrust(row: TrustColumns, now: Date): Trust {
	if (row.trust === "low" || row.trust === "high") return row.trust;
	return counts(row.client_seen_at, trustCutoff(now)) ? "low" : "high";
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
 * effectiveTrust() in SQL, for a projects row with the given alias. It has one parameter:
 * trustCutoff(now). SQL text from constants only (no values).
 */
export const EFFECTIVE_TRUST_SQL = (alias: "p" | "projects") =>
	`coalesce(${alias}.trust, CASE WHEN ${alias}.client_seen_at >= ? THEN 'low' ELSE 'high' END)`;

/** The trust fields of the API (additive): trust, source_trust (always equal), source. */
export function trustFields(row: TrustColumns, now: Date) {
	const trust = effectiveTrust(row, now);
	return { trust, source_trust: trust, source: sourceOf(row, now) };
}
