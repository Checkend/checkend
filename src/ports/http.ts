/** Outgoing HTTP requests (webhook deliveries). */
export interface HttpClient {
	/**
	 * maxBytes: the most bytes of the response body that the client reads (Node: default 64 KB,
	 * enough for a webhook answer); above it, the body is cut, the header x-checkend-truncated is
	 * true, and the connection closes. The runtime fetch streams and ignores it.
	 */
	send(url: string, init: RequestInit, options?: { maxBytes?: number }): Promise<Response>;
}

/** The runtime fetch. */
export const fetchClient: HttpClient = { send: (url, init) => fetch(url, init) };

/** A queue that starts webhook deliveries (Cloudflare Queues). Optional. */
export interface NotifyQueue {
	send(message: { kind: "deliver" }): Promise<void>;
}
