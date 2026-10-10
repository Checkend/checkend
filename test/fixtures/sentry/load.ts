import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface SentryFixture {
	name: string;
	sdk: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body: Uint8Array;
}

/** The golden fixtures: real requests recorded from Sentry SDKs. */
export function loadSentryFixtures(): SentryFixture[] {
	const dir = import.meta.dirname;
	return readdirSync(dir)
		.filter((file) => file.endsWith(".json"))
		.sort()
		.map((file) => {
			const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
			return {
				name: file.replace(/\.json$/, ""),
				sdk: raw.sdk,
				method: raw.method,
				path: raw.path,
				headers: raw.headers,
				body: new Uint8Array(Buffer.from(raw.bodyBase64, "base64")),
			};
		});
}

export function loadSentryFixture(name: string): SentryFixture {
	const fixture = loadSentryFixtures().find((f) => f.name === name);
	if (!fixture) throw new Error(`No fixture ${name}`);
	return fixture;
}
