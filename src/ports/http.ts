/** Outgoing HTTP requests (webhook deliveries). */
export interface HttpClient {
	send(url: string, init: RequestInit): Promise<Response>;
}

/** The runtime fetch. */
export const fetchClient: HttpClient = { send: (url, init) => fetch(url, init) };

/** A queue that starts webhook deliveries (Cloudflare Queues). Optional. */
export interface NotifyQueue {
	send(message: { kind: "deliver" }): Promise<void>;
}
