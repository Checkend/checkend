import { lookup } from "node:dns/promises";
import type { Resolver } from "../../ports/resolver.ts";

/** The system resolver (the same addresses that a Node request would use). */
export const systemResolver: Resolver = {
	async resolve(hostname) {
		try {
			return (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);
		} catch {
			return [];
		}
	},
};
