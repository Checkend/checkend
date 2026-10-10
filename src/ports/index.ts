import type { Clock } from "./clock.ts";
import type { Db } from "./db.ts";

export type { Clock } from "./clock.ts";
export type { Db } from "./db.ts";

/**
 * Everything the app needs from its runtime (D16). Each entry builds one from its
 * environment: `adapters/cloudflare/ports.ts` for the Worker. Add a port when the first
 * feature needs it (D17 rule 8).
 */
export interface Ports {
	db: Db;
	clock: Clock;
}
