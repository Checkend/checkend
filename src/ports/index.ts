import type { Clock } from "./clock.ts";
import type { Db } from "./db.ts";

export type { Clock } from "./clock.ts";
export type { Db } from "./db.ts";

/**
 * Everything the app needs from its runtime. Each entry builds one from its
 * environment: `adapters/cloudflare/ports.ts` for the Worker. Add a port when the first
 * feature needs it.
 */
export interface Ports {
	db: Db;
	clock: Clock;
}
