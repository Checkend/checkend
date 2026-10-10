// Records real requests from a Sentry SDK in another language as golden fixtures.
// Run: node test/fixtures/sentry/capture-sdk.ts <prefix> <deps-dir> <command> [args...]
// For each scenario (type-error, message), it runs the command with SENTRY_DSN (a local server)
// and FIXTURE_SCENARIO, keeps the first request with an event, and writes <prefix>-<scenario>.json
// next to this file. Local paths become /app (this repository) and /deps (<deps-dir>), so the
// public fixtures do not show the machine they came from. See sdk/README.md.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

const [prefix, depsDir, command, ...args] = process.argv.slice(2);
if (!prefix || !depsDir || !command) {
	throw new Error("Usage: capture-sdk.ts <prefix> <deps-dir> <command> [args...]");
}

type Captured = { method: string; path: string; headers: Record<string, string>; body: Buffer };
const captured: Captured[] = [];
const keep = ["content-type", "content-encoding", "x-sentry-auth", "user-agent"];
const read = (req: IncomingMessage) =>
	new Promise<Buffer>((done) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => done(Buffer.concat(chunks)));
	});
const server = createServer(async (req, res) => {
	const body = await read(req);
	const headers: Record<string, string> = {};
	for (const name of keep) {
		const value = req.headers[name];
		if (typeof value === "string") headers[name] = value;
	}
	captured.push({ method: req.method ?? "", path: req.url ?? "", headers, body });
	res.writeHead(200, { "content-type": "application/json" }).end("{}");
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const { port } = server.address() as AddressInfo;

const decode = (request: Captured) => {
	const encoding = request.headers["content-encoding"];
	return (encoding === "gzip" ? gunzipSync(request.body) : request.body).toString("utf8");
};
const repoRoot = resolve(import.meta.dirname, "../../..");
const replacements: [string, string][] = [
	[resolve(depsDir), "/deps"],
	[repoRoot, "/app"],
	[homedir(), "/home/app"],
];

/**
 * Rewrites the payloads of an envelope and sets each item's "length" again (when the item header
 * has one): a payload that changes size must keep the envelope valid.
 */
function rewriteEnvelope(envelope: string, change: (payload: string) => string): string {
	const bytes = Buffer.from(envelope, "utf8");
	let at = bytes.indexOf(10);
	const out = [change(bytes.subarray(0, at).toString("utf8"))];
	at += 1;
	while (at < bytes.length) {
		const headerEnd = bytes.indexOf(10, at);
		const headerText = bytes
			.subarray(at, headerEnd < 0 ? bytes.length : headerEnd)
			.toString("utf8");
		if (!headerText.trim()) break;
		const header = JSON.parse(headerText) as { length?: number };
		const start = headerEnd + 1;
		const end =
			typeof header.length === "number"
				? start + header.length
				: (() => {
						const next = bytes.indexOf(10, start);
						return next < 0 ? bytes.length : next;
					})();
		const payload = change(bytes.subarray(start, end).toString("utf8"));
		const newHeader =
			typeof header.length === "number"
				? JSON.stringify({ ...header, length: Buffer.byteLength(payload, "utf8") })
				: headerText;
		out.push(newHeader, payload);
		at = end + 1;
	}
	return `${out.join("\n")}\n`;
}

for (const scenario of ["type-error", "message"]) {
	const before = captured.length;
	const child = spawn(command, args, {
		stdio: "inherit",
		// CAPTURE_CWD: the project directory, for SDKs that mark in-app frames by it (Python, Ruby).
		cwd: process.env.CAPTURE_CWD ?? depsDir,
		env: {
			...process.env,
			SENTRY_DSN: `http://0123456789abcdef0123456789abcdef@127.0.0.1:${port}/1`,
			FIXTURE_SCENARIO: scenario,
			DEPS: resolve(depsDir),
		},
	});
	// Async: the capture server in this process must answer while the command runs.
	const status = await new Promise<number | null>((done) => child.on("close", done));
	if (status !== 0) throw new Error(`${prefix} ${scenario}: the command failed`);
	// Some SDKs send while the process ends: give the server a moment.
	await new Promise((done) => setTimeout(done, 300));
	const request = captured.slice(before).find((r) => decode(r).includes('"type":"event"'));
	if (!request) throw new Error(`${prefix} ${scenario}: no event request captured`);
	const text = rewriteEnvelope(decode(request), (payload) => {
		let out = payload;
		for (const [from, to] of replacements) {
			// Some SDKs (PHP) write "/" as "\\/" in JSON.
			out = out
				.replaceAll(from, to)
				.replaceAll(from.replaceAll("/", "\\/"), to.replaceAll("/", "\\/"));
		}
		return out;
	});
	const gzip = request.headers["content-encoding"] === "gzip";
	request.body = gzip ? gzipSync(Buffer.from(text, "utf8")) : Buffer.from(text, "utf8");
	const lines = text.split("\n");
	const itemAt = lines.findIndex((line) => /^\{.*"type":"event"/.test(line));
	const event = JSON.parse(lines[itemAt + 1] ?? "{}") as {
		sdk?: { name?: string; version?: string };
	};
	const fixture = {
		sdk: event.sdk?.name ?? prefix,
		sdkVersion: event.sdk?.version ?? "unknown",
		method: request.method,
		path: request.path,
		headers: request.headers,
		bodyBase64: request.body.toString("base64"),
	};
	writeFileSync(
		join(import.meta.dirname, `${prefix}-${scenario}.json`),
		`${JSON.stringify(fixture, null, "\t")}\n`,
	);
	console.log(
		`${prefix}-${scenario}: ${fixture.sdk} ${fixture.sdkVersion}, ${request.body.length} bytes`,
	);
}
server.close();
