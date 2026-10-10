import type { Resolver } from "../ports/resolver.ts";

/**
 * Rules for URLs that Checkend sends requests to (webhooks): https only, no credentials in the
 * URL, and a host whose addresses are all public. Private, loopback, link-local (cloud
 * metadata), carrier-grade NAT, multicast and reserved ranges are blocked, after DNS
 * resolution: a public name can point to a private address. Checkend checks the URL when it
 * is saved and again before each delivery; deliveries do not follow redirects.
 *
 * On Workers, requests cannot reach private networks anyway. The rules matter for other
 * runtimes (Docker), where a webhook could reach the host network.
 */

export type UrlCheck = { ok: true } | { ok: false; reason: string };

const PRIVATE_NAMES = /(^|\.)(localhost|local|internal|home\.arpa)$/i;

function ipv4Number(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let n = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
		n = n * 256 + Number(part);
	}
	return n;
}

// [first address, prefix length]
const BLOCKED_V4: [string, number][] = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
];

function isPublicV4(n: number): boolean {
	return !BLOCKED_V4.some(([base, bits]) => {
		const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
		return (n & mask) >>> 0 === ((ipv4Number(base) ?? 0) & mask) >>> 0;
	});
}

/** The 8 groups of an IPv6 address, or null. Accepts "::" and an embedded IPv4 tail. */
function ipv6Groups(ip: string): number[] | null {
	let text = ip.toLowerCase().replace(/%.*$/, "");
	const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
	if (v4?.[1]) {
		const n = ipv4Number(v4[1]);
		if (n === null) return null;
		text = `${text.slice(0, -v4[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
	}
	const halves = text.split("::");
	if (halves.length > 2) return null;
	const parse = (part: string) => (part ? part.split(":") : []);
	const head = parse(halves[0] ?? "");
	const tail = parse(halves[1] ?? "");
	const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
	if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
	const groups = [...head, ...Array(fill).fill("0"), ...tail];
	if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
	return groups.map((g) => Number.parseInt(g, 16));
}

/** True for a public unicast address. False for private and special ranges, and non-IPs. */
export function isPublicAddress(ip: string): boolean {
	const v4 = ipv4Number(ip);
	if (v4 !== null) return isPublicV4(v4);
	const g = ipv6Groups(ip);
	if (!g) return false;
	const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, h6 = 0, h7 = 0] = g;
	const embeddedV4 = (h6 * 65536 + h7) >>> 0;
	if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && (f === 0 || f === 0xffff)) {
		// ::, ::1, IPv4-compatible and IPv4-mapped (::ffff:a.b.c.d)
		return f === 0xffff ? isPublicV4(embeddedV4) : false;
	}
	if (a === 0x64 && b === 0xff9b) return isPublicV4(embeddedV4); // NAT64
	if ((a & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
	if ((a & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
	if ((a & 0xff00) === 0xff00) return false; // multicast
	if (a === 0x2001 && b === 0x0db8) return false; // documentation
	if (a === 0x0100 && b === 0 && c === 0 && d === 0) return false; // discard 100::/64
	return (a & 0xe000) === 0x2000; // global unicast 2000::/3
}

/** Checks a URL before Checkend sends a request to it. */
export async function checkOutboundUrl(text: string, resolver: Resolver): Promise<UrlCheck> {
	let url: URL;
	try {
		url = new URL(text);
	} catch {
		return { ok: false, reason: "Not a valid URL." };
	}
	if (url.protocol !== "https:") return { ok: false, reason: "The URL must use https." };
	if (url.username || url.password) {
		return { ok: false, reason: "The URL must not contain credentials." };
	}
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const literal = ipv4Number(host) !== null || host.includes(":");
	if (!literal && PRIVATE_NAMES.test(host)) {
		return { ok: false, reason: `The host ${host} is a private name.` };
	}
	const addresses = literal ? [host] : await resolver.resolve(host).catch(() => []);
	if (addresses.length === 0) return { ok: false, reason: `The host ${host} does not resolve.` };
	const blocked = addresses.find((ip) => !isPublicAddress(ip));
	if (blocked) return { ok: false, reason: `The host ${host} has a private address (${blocked}).` };
	return { ok: true };
}
