import type { Resolver } from "../../ports/resolver.ts";

const DOH = "https://cloudflare-dns.com/dns-query";
const TYPES = { A: 1, AAAA: 28 } as const;

/** DNS over HTTPS (Cloudflare 1.1.1.1, JSON API): A and AAAA records. */
export const dohResolver: Resolver = {
	async resolve(hostname) {
		const answers = await Promise.all(
			(Object.keys(TYPES) as (keyof typeof TYPES)[]).map(async (type) => {
				const url = `${DOH}?name=${encodeURIComponent(hostname)}&type=${type}`;
				const response = await fetch(url, { headers: { accept: "application/dns-json" } });
				if (!response.ok) throw new Error(`DNS lookup failed: ${response.status}`);
				const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
				return (body.Answer ?? []).filter((a) => a.type === TYPES[type]).map((a) => a.data);
			}),
		);
		return answers.flat();
	},
};
