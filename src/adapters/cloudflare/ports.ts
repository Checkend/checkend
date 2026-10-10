import { systemClock } from "../../core/clock.ts";
import type { Ports } from "../../ports/index.ts";
import { d1Db } from "./d1-db.ts";

/** Builds the ports from the Worker bindings. */
export function cloudflarePorts(env: Env): Ports {
	return { db: d1Db(env.DB), clock: systemClock };
}
