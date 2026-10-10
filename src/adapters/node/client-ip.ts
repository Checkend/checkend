import { BlockList, isIP } from "node:net";

/**
 * The client address behind trusted proxies. TRUSTED_PROXIES is a comma-separated list of
 * addresses and CIDR ranges, plus the words "loopback" and "private". X-Forwarded-For is read
 * from the right, only while the address so far is a trusted proxy: a client cannot choose its
 * own address by sending the header. Without TRUSTED_PROXIES, the socket address is used.
 */
export function clientIpResolver(trustedProxies: string | undefined) {
	const trusted = new BlockList();
	let any = false;
	const add = (entry: string) => {
		const [address = "", prefix] = entry.split("/");
		const type = isIP(address) === 6 ? "ipv6" : "ipv4";
		if (!isIP(address)) throw new Error(`TRUSTED_PROXIES: not an address: ${entry}`);
		if (prefix === undefined) trusted.addAddress(address, type);
		else trusted.addSubnet(address, Number(prefix), type);
		any = true;
	};
	for (const raw of (trustedProxies ?? "").split(",")) {
		const entry = raw.trim();
		if (!entry) continue;
		if (entry === "loopback") ["127.0.0.0/8", "::1/128"].forEach(add);
		else if (entry === "private")
			["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"].forEach(add);
		else add(entry);
	}
	const normalize = (address: string) => address.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, "$1");
	const isTrusted = (address: string) => {
		const type = isIP(address);
		return type !== 0 && trusted.check(address, type === 6 ? "ipv6" : "ipv4");
	};
	return (socketAddress: string | undefined, request: Request): string => {
		let address = normalize(socketAddress ?? "unknown");
		if (!any) return address;
		const forwarded = (request.headers.get("x-forwarded-for") ?? "")
			.split(",")
			.map((part) => normalize(part.trim()))
			.filter(Boolean);
		while (isTrusted(address) && forwarded.length > 0) {
			const next = forwarded.pop() as string;
			if (isIP(next) === 0) break;
			address = next;
		}
		return address;
	};
}
