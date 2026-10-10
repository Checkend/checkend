// Records real requests from the Sentry Node SDK as golden fixtures.
// Run: node test/fixtures/sentry/capture-node.ts
// It starts a local server, points the SDK at it, captures a few errors, and writes
// node-*.json next to this file. Commit the result; tests replay the exact bytes.
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as Sentry from "@sentry/node";

type Captured = { method: string; path: string; headers: Record<string, string>; body: Buffer };
const captured: Captured[] = [];

const keep = ["content-type", "content-encoding", "content-length", "x-sentry-auth", "user-agent"];
const read = (req: IncomingMessage) =>
	new Promise<Buffer>((resolve) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => resolve(Buffer.concat(chunks)));
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
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as AddressInfo;

Sentry.init({
	dsn: `http://0123456789abcdef0123456789abcdef@127.0.0.1:${port}/1`,
	release: "fixture-app@1.2.3",
	environment: "production",
	serverName: "fixture-host",
	sendClientReports: false,
	defaultIntegrations: false,
	integrations: [Sentry.contextLinesIntegration(), Sentry.linkedErrorsIntegration()],
});

function loadUser(id: string): { name: string } {
	const users: Record<string, { name: string }> = {};
	return users[id] as { name: string };
}

const scenarios: [string, () => void][] = [
	[
		"node-type-error",
		() => {
			try {
				loadUser("42").name.toUpperCase();
			} catch (error) {
				Sentry.setTag("route", "/users/:id");
				Sentry.setUser({ id: "user-42", email: "ada@example.com" });
				Sentry.addBreadcrumb({ category: "db", message: "SELECT * FROM users WHERE id = 42" });
				Sentry.captureException(error);
			}
		},
	],
	[
		"node-error-with-cause",
		() => {
			const cause = new RangeError("Invalid port 70000");
			Sentry.captureException(new Error("Failed to start the server", { cause }));
		},
	],
	[
		"node-message",
		() => Sentry.captureMessage("Cache miss rate above 90% for key user:1234", "warning"),
	],
	[
		"node-secrets",
		() => {
			Sentry.setContext("request_headers", {
				authorization: "Bearer sk_live_51Habcdefghijklmnop",
				cookie: "session=abc123",
			});
			Sentry.setExtra("password", "hunter2");
			Sentry.setExtra("card", "4242 4242 4242 4242");
			Sentry.captureException(new Error("Payment failed for order 99123"));
		},
	],
	[
		"node-gzip-large",
		() => {
			// Above the SDK's compression threshold, so the body arrives gzip-encoded.
			Sentry.setExtra("blob", "x".repeat(40_000));
			Sentry.captureException(new Error("Large payload"));
		},
	],
];

for (const [name, run] of scenarios) {
	const before = captured.length;
	Sentry.withScope(() => run());
	await Sentry.flush(5000);
	const request = captured[before];
	if (!request) throw new Error(`No request captured for ${name}`);
	// Replace local paths, so that the public fixtures do not show the machine they came from.
	const repoRoot = resolve(import.meta.dirname, "../../..");
	const gzip = request.headers["content-encoding"] === "gzip";
	const text = (gzip ? gunzipSync(request.body) : request.body).toString("utf8");
	const clean = Buffer.from(text.replaceAll(repoRoot, "/app"), "utf8");
	request.body = gzip ? gzipSync(clean) : clean;
	delete request.headers["content-length"];
	const fixture = {
		sdk: "@sentry/node",
		sdkVersion: Sentry.SDK_VERSION,
		method: request.method,
		path: request.path,
		headers: request.headers,
		bodyBase64: request.body.toString("base64"),
	};
	writeFileSync(
		join(import.meta.dirname, `${name}.json`),
		`${JSON.stringify(fixture, null, "\t")}\n`,
	);
	console.log(
		`${name}: ${request.body.length} bytes, ${request.headers["content-encoding"] ?? "identity"}`,
	);
}

server.close();
await Sentry.close();
