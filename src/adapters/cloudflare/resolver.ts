import type { Resolver } from "../../ports/resolver.ts";

const DOH = "https://cloudflare-dns.com/dns-query";
const TYPES = { A: 1, AAAA: 28 } as const;
const TIMEOUT_MS = 3000;

/**
 * DNS over HTTPS (Cloudflare 1.1.1.1, JSON API): A and AAAA records. A failed lookup gives no
 * addresses: the host then does not pass the check (fail closed).
 */
export const dohResolver: Resolver = {
	async resolve(hostname) {
		try {
			return await lookupBoth(hostname);
		} catch {
			return [];
		}
	},
};

async function lookupBoth(hostname: string): Promise<string[]> {
	const answers = await Promise.all(
		(Object.keys(TYPES) as (keyof typeof TYPES)[]).map(async (type) => {
			const url = `${DOH}?name=${encodeURIComponent(hostname)}&type=${type}`;
			const response = await fetch(url, {
				headers: { accept: "application/dns-json" },
				// A hanging lookup must not stall a delivery: after the timeout, no addresses.
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (!response.ok) throw new Error(`DNS lookup failed: ${response.status}`);
			const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
			return (body.Answer ?? []).filter((a) => a.type === TYPES[type]).map((a) => a.data);
		}),
	);
	return answers.flat();
}
