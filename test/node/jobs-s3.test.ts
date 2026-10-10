import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jobStatement, runJobs, sqliteJobQueue } from "../../src/adapters/node/jobs-queue.ts";
import { s3BlobStore } from "../../src/adapters/node/s3-blob-store.ts";
import { signV4 } from "../../src/adapters/node/sigv4.ts";
import { consumeIngest, enqueueEvent } from "../../src/core/ingest/overflow.ts";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createProject } from "../../src/core/projects.ts";
import { sql } from "../../src/ports/db.ts";
import { blobStoreContract } from "../contract/blob-store-contract.ts";
import { ingestQueueContract } from "../contract/ingest-queue-contract.ts";
import { testPorts } from "../support/node-ports.ts";

const contractPorts = await testPorts();
ingestQueueContract("SQLite jobs table (Node)", () =>
	sqliteJobQueue(contractPorts.ports.db, "contract", contractPorts.clock),
);

describe("the jobs table queue", () => {
	it("acknowledged jobs go; retried jobs come back after a backoff; then they are dead", async () => {
		const { ports, clock } = await testPorts();
		const queue = sqliteJobQueue(ports.db, "q", clock);
		await queue.send({ n: 1 });
		await queue.send({ n: 2 });
		const seen: unknown[] = [];
		await runJobs(ports.db, clock, "q", async (items) => {
			for (const item of items) {
				seen.push(item.body);
				if ((item.body as { n: number }).n === 1) item.ack();
				else item.retry();
			}
		});
		expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
		expect(await runJobs(ports.db, clock, "q", async () => {})).toBe(0); // the retry waits
		for (let i = 0; i < 6; i++) {
			clock.advance(3_600_000);
			await runJobs(
				ports.db,
				clock,
				"q",
				async () => {
					throw new Error("still failing");
				},
				{ maxAttempts: 3 },
			);
		}
		expect(await ports.db.all(sql`SELECT status, attempts, last_error FROM jobs`)).toEqual([
			{ status: "dead", attempts: 3, last_error: "Error: still failing" },
		]);
	});

	it("a claimed job is not claimed again until its lock (the visibility timeout) ends", async () => {
		const { ports, clock } = await testPorts();
		await sqliteJobQueue(ports.db, "q", clock).send({ n: 1 });
		let inside = 0;
		await runJobs(
			ports.db,
			clock,
			"q",
			async () => {
				inside = await runJobs(ports.db, clock, "q", async () => {});
				// A crash here: the job is neither acknowledged nor retried in time.
				throw new Error("crash");
			},
			{ visibilityMs: 60_000 },
		);
		expect(inside).toBe(0);
	});

	it("an enqueue in a batch is in the same transaction as the write", async () => {
		const { ports, clock } = await testPorts();
		await expect(
			ports.db.batch([
				jobStatement("q", { n: 1 }, clock.now()),
				sql`INSERT INTO no_such_table VALUES (1)`,
			]),
		).rejects.toThrow();
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM jobs`)).toEqual({ n: 0 });
	});

	it("carries ingest overflow: the consumer writes the queued events", async () => {
		const { ports, clock } = await testPorts();
		const project = await createProject(ports, { name: "Jobs" });
		const queue = sqliteJobQueue(ports.db, "ingest", clock);
		for (const message of ["a", "a", "b"]) {
			const prepared = await prepareEvent(
				new TextEncoder().encode(JSON.stringify({ message })),
				clock.now(),
			);
			expect(
				await enqueueEvent(
					{ ingestQueue: queue, blobs: null },
					project.internalId,
					prepared,
					false,
				),
			).toBe(true);
		}
		const state = new IngestState();
		await runJobs(ports.db, clock, "ingest", (items) => consumeIngest(ports, state, items));
		expect(await ports.db.all(sql`SELECT title, times_seen FROM issues ORDER BY title`)).toEqual([
			{ title: "a", times_seen: 2 },
			{ title: "b", times_seen: 1 },
		]);
		expect(await ports.db.first(sql`SELECT count(*) AS n FROM jobs`)).toEqual({ n: 0 });
	});
});

describe("SigV4", () => {
	it("signs the example request of the AWS documentation", async () => {
		// GET https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08 on 2015-08-30.
		const authorization = await signV4({
			method: "GET",
			url: new URL("https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08"),
			headers: {
				"content-type": "application/x-www-form-urlencoded; charset=utf-8",
				"x-amz-date": "20150830T123600Z",
			},
			payloadHash: createHash("sha256").update("").digest("hex"),
			accessKeyId: "AKIDEXAMPLE",
			secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
			region: "us-east-1",
			service: "iam",
			amzDate: "20150830T123600Z",
		});
		expect(authorization).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7",
		);
	});
});

// A fake S3 server: it keeps objects by path, and checks the signature header and payload hash.
const objects = new Map<string, Buffer>();
let s3Base = "";
const s3 = createServer((request, response) => {
	const chunks: Buffer[] = [];
	request.on("data", (chunk: Buffer) => chunks.push(chunk));
	request.on("end", () => {
		const body = Buffer.concat(chunks);
		const auth = String(request.headers.authorization ?? "");
		const hash = createHash("sha256").update(body).digest("hex");
		if (
			!auth.startsWith("AWS4-HMAC-SHA256 Credential=key/") ||
			request.headers["x-amz-content-sha256"] !== hash
		) {
			response.writeHead(403).end("SignatureDoesNotMatch");
			return;
		}
		const path = decodeURIComponent(request.url ?? "");
		if (request.method === "PUT") {
			objects.set(path, body);
			response.writeHead(200).end();
		} else if (request.method === "GET") {
			const object = objects.get(path);
			if (object) response.writeHead(200).end(object);
			else response.writeHead(404).end("NoSuchKey");
		} else if (request.method === "DELETE") {
			objects.delete(path);
			response.writeHead(204).end();
		} else response.writeHead(405).end();
	});
});
beforeAll(async () => {
	await new Promise<void>((resolve) => s3.listen(0, "127.0.0.1", resolve));
	s3Base = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
});
afterAll(() => {
	s3.close();
});
blobStoreContract("S3 (a fake S3 server)", () =>
	s3BlobStore({
		endpoint: s3Base,
		region: "auto",
		bucket: "checkend",
		accessKeyId: "key",
		secretAccessKey: "secret",
	}),
);
