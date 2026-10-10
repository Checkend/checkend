import type { Clock } from "./clock.ts";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { Defer } from "./defer.ts";
import type { RateLimiter } from "./rate-limiter.ts";
import type { Resolver } from "./resolver.ts";

export type { Clock } from "./clock.ts";
export type { Config } from "./config.ts";
export type { Db } from "./db.ts";
export type { Defer } from "./defer.ts";
export type { RateLimiter } from "./rate-limiter.ts";
export type { Resolver } from "./resolver.ts";

/**
 * Everything the app needs from its runtime. Each entry builds one from its environment:
 * `adapters/cloudflare/ports.ts` for the Worker. Add a port when the first feature needs it.
 */
export interface Ports {
	db: Db;
	clock: Clock;
	defer: Defer;
	rateLimiter: RateLimiter;
	config: Config;
	/** DNS, for the SSRF check of webhook URLs. */
	resolver: Resolver;
}
