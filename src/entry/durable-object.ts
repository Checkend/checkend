import { DurableObject } from "cloudflare:workers";

/** One hosted install: one Checkend install in one Durable Object (built in the next step). */
export class CheckendInstall extends DurableObject {}
