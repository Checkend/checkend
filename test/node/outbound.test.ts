import { describe, expect, it } from "vitest";
import { checkOutboundUrl, isPublicAddress } from "../../src/core/outbound.ts";

const resolver = (table: Record<string, string[]>) => ({
	resolve: async (host: string) => table[host] ?? [],
});

describe("outbound URLs (SSRF rules)", () => {
	it("knows private, loopback, link-local and metadata addresses", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"0.0.0.0",
			"224.0.0.1",
			"255.255.255.255",
			"::1",
			"::",
			"fe80::1",
			"fd00:ec2::254",
			"fc00::1",
			"::ffff:127.0.0.1",
			"::ffff:7f00:1",
			"64:ff9b::a9fe:a9fe",
			"ff02::1",
		]) {
			expect(isPublicAddress(ip), ip).toBe(false);
		}
		for (const ip of ["93.184.216.34", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) {
			expect(isPublicAddress(ip), ip).toBe(true);
		}
	});

	it("accepts https URLs whose host resolves to public addresses only", async () => {
		const dns = resolver({ "hooks.example": ["93.184.216.34", "2606:4700::1"] });
		expect(await checkOutboundUrl("https://hooks.example/checkend?x=1", dns)).toEqual({ ok: true });
		expect(await checkOutboundUrl("https://1.1.1.1/hook", dns)).toEqual({ ok: true });
	});

	it("rejects other schemes, credentials, private hosts, and hosts that do not resolve", async () => {
		const dns = resolver({
			"mixed.example": ["93.184.216.34", "10.0.0.5"],
			"rebind.example": ["127.0.0.1"],
		});
		const cases: [string, RegExp][] = [
			["http://hooks.example/", /https/],
			["ftp://hooks.example/", /https/],
			["https://user:pass@hooks.example/", /credentials/],
			["https://localhost/", /private/],
			["https://app.localhost/", /private/],
			["https://metadata.google.internal/", /private/],
			["https://169.254.169.254/latest/meta-data", /private/],
			["https://[::1]/", /private/],
			["https://mixed.example/", /private/],
			["https://rebind.example/", /private/],
			["https://nowhere.example/", /resolve/],
			["not a url", /URL/],
		];
		for (const [url, reason] of cases) {
			const result = await checkOutboundUrl(url, dns);
			expect(result.ok, url).toBe(false);
			if (!result.ok) expect(result.reason, url).toMatch(reason);
		}
	});
});
