/** DNS for the SSRF rules of outgoing requests (core/outbound.ts). */
export interface Resolver {
	/** The IPv4 and IPv6 addresses of a host name; empty when it does not resolve. */
	resolve(hostname: string): Promise<string[]>;
}

/** Resolves nothing: every host name fails the check. For runtimes without DNS. */
export const noResolver: Resolver = { resolve: async () => [] };
