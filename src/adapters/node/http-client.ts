import { lookup as dnsLookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { isPublicAddress } from "../../core/outbound.ts";
import type { HttpClient } from "../../ports/http.ts";

/**
 * Outgoing requests that connect to the address that was checked (DNS rebinding): the lookup of
 * the connection itself checks every address and returns only public ones, so there is no second
 * lookup between the check and the connection. Redirects are not followed (as with
 * redirect: "manual"). `allowPrivate` is for tests only.
 */
/** A webhook answer needs only its status; callers that read JSON pass a larger cap. */
const DEFAULT_MAX_BYTES = 64 * 1024;

export function pinnedHttpClient(
	options: { lookup?: LookupFunction; allowPrivate?: boolean } = {},
): HttpClient {
	const baseLookup: LookupFunction = options.lookup ?? (dnsLookup as LookupFunction);
	const checkedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
		baseLookup(hostname, { ...lookupOptions, all: true }, (error, addresses) => {
			if (error) return callback(error, "", 0);
			const list = (Array.isArray(addresses) ? addresses : [{ address: addresses, family: 4 }]) as {
				address: string;
				family: number;
			}[];
			const blocked = list.find((a) => !options.allowPrivate && !isPublicAddress(a.address));
			if (list.length === 0 || blocked) {
				const reason = blocked
					? `${hostname} has a private address (${blocked.address})`
					: `${hostname} does not resolve`;
				return callback(Object.assign(new Error(reason), { code: "EBLOCKED" }), "", 0);
			}
			if (lookupOptions.all)
				return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
			const first = list[0] as { address: string; family: number };
			callback(null, first.address, first.family);
		});
	};
	return {
		send(url, init, sendOptions = {}) {
			const maxBytes = sendOptions.maxBytes ?? DEFAULT_MAX_BYTES;
			return new Promise((resolve, reject) => {
				const target = new URL(url);
				const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
					target,
					{
						method: init.method ?? "GET",
						headers: Object.fromEntries(new Headers(init.headers).entries()),
						lookup: checkedLookup,
					},
					(response) => {
						const chunks: Buffer[] = [];
						let length = 0;
						let done = false;
						const finish = (truncated: boolean) => {
							if (done) return;
							done = true;
							const headers = new Headers();
							for (const [name, value] of Object.entries(response.headers)) {
								if (typeof value === "string") headers.set(name, value);
								else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
							}
							if (truncated) headers.set("x-checkend-truncated", "true");
							const status = response.statusCode ?? 0;
							const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);
							resolve(new Response(body, { status, headers }));
						};
						response.on("data", (chunk: Buffer) => {
							if (done) return;
							if (length + chunk.byteLength > maxBytes) {
								// The cap: keep what fits, stop reading, and close the connection.
								chunks.push(chunk.subarray(0, maxBytes - length));
								length = maxBytes;
								finish(true);
								request.destroy();
								return;
							}
							chunks.push(chunk);
							length += chunk.byteLength;
						});
						response.on("end", () => finish(false));
						response.on("error", reject);
					},
				);
				request.on("error", reject);
				init.signal?.addEventListener("abort", () => request.destroy(new Error("aborted")), {
					once: true,
				});
				if (init.body !== undefined && init.body !== null) request.write(String(init.body));
				request.end();
			});
		},
	};
}
