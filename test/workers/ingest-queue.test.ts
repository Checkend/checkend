import { env } from "cloudflare:test";
import { cloudflareIngestQueue } from "../../src/adapters/cloudflare/ingest-queue.ts";
import { ingestQueueContract } from "../contract/ingest-queue-contract.ts";

ingestQueueContract("Cloudflare Queue", () => cloudflareIngestQueue(env.INGEST_QUEUE));
