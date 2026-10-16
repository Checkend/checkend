/** Outgoing HTTP requests (webhook deliveries). */
export interface HttpClient {
	/**
	 * maxBytes: the most bytes of the response body that the client reads (Node: default 64 KB,
	 * enough for a webhook answer); above it, the body is cut, the header x-checkend-truncated is
	 * true, and the connection closes. The runtime fetch streams and ignores it.
	 */
	send(url: string, init: RequestInit, options?: { maxBytes?: number }): Promise<Response>;
}

/**
 * The longest time of any outgoing request. A call that waits keeps a hosted install (a Durable
 * Object) in memory, and the Cloud pays for each second, so no call may wait without end.
 */
export const HTTP_TIMEOUT_MS = 15_000;

/** Every call ends after `ms` at the latest; a signal of the caller still ends it sooner. */
export function withTimeout(client: HttpClient, ms = HTTP_TIMEOUT_MS): HttpClient {
	return {
		send: (url, init, options) => {
			const timeout = AbortSignal.timeout(ms);
			const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
			return client.send(url, { ...init, signal }, options);
		},
	};
}

/** The runtime fetch, with the timeout. */
export const fetchClient: HttpClient = withTimeout({ send: (url, init) => fetch(url, init) });

/** A queue that starts webhook deliveries (Cloudflare Queues). Optional. */
export interface NotifyQueue {
	send(message: { kind: "deliver" }): Promise<void>;
}
