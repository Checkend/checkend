// Records real requests from the Sentry browser SDK as golden fixtures.
// Run: node test/fixtures/sentry/capture-browser.ts, then open each URL that it prints in a
// browser. The page and the ingest server have different origins, as in production.
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { build } from "esbuild";

const scenarios = [
	"browser-caught-type-error",
	"browser-unhandled-error",
	"browser-unhandled-rejection",
	"browser-message",
];
const keep = ["content-type", "content-encoding", "origin", "referer", "user-agent"];

const listen = async (server: Server) => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	return (server.address() as AddressInfo).port;
};
const read = (req: IncomingMessage) =>
	new Promise<Buffer>((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
	});

const pending = new Set(scenarios);
const ingest = createServer(async (req, res) => {
	const cors = { "access-control-allow-origin": "*" };
	if (req.method === "OPTIONS") {
		res.writeHead(204, { ...cors, "access-control-allow-headers": "*" }).end();
		return;
	}
	const body = await read(req);
	const referer = req.headers.referer ?? "";
	const page = new URL(referer || "http://x/").searchParams.get("scenario") ?? "";
	const text = body.toString("utf8");
	const name = scenarios.find((s) => text.includes(`scenario=${s}"`)) ?? page;
	const headers: Record<string, string> = {};
	for (const header of keep) {
		const value = req.headers[header];
		if (typeof value === "string") headers[header] = value;
	}
	if (pending.has(name)) {
		pending.delete(name);
		const fixture = {
			sdk: "@sentry/browser",
			method: req.method,
			path: req.url,
			headers,
			bodyBase64: body.toString("base64"),
		};
		writeFileSync(
			join(import.meta.dirname, `${name}.json`),
			`${JSON.stringify(fixture, null, "\t")}\n`,
		);
		console.log(`saved ${name}: ${body.length} bytes`);
		if (pending.size === 0) setTimeout(() => process.exit(0), 200);
	}
	res.writeHead(200, { ...cors, "content-type": "application/json" }).end("{}");
});
const ingestPort = await listen(ingest);

const bundle = await build({
	entryPoints: [join(import.meta.dirname, "browser-app.ts")],
	bundle: true,
	minify: true,
	sourcemap: false,
	write: false,
	format: "iife",
	define: {
		DSN: JSON.stringify(`http://0123456789abcdef0123456789abcdef@127.0.0.1:${ingestPort}/2`),
	},
});
const script = bundle.outputFiles[0]?.text ?? "";
const scriptName = "app.3f9a2c1b.js";

const site = createServer((req, res) => {
	if (req.url?.startsWith(`/assets/${scriptName}`)) {
		res.writeHead(200, { "content-type": "text/javascript" }).end(script);
		return;
	}
	// The scenario name is in the title too, so that the ingest server can match each request.
	res
		.writeHead(200, { "content-type": "text/html" })
		.end(`<!doctype html><title>shop</title><script src="/assets/${scriptName}"></script>`);
});
const sitePort = await listen(site);

for (const name of scenarios) console.log(`http://127.0.0.1:${sitePort}/checkout?scenario=${name}`);
