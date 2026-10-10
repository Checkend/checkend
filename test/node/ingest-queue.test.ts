import { memoryIngestQueue } from "../../src/ports/ingest-queue.ts";
import { ingestQueueContract } from "../contract/ingest-queue-contract.ts";

ingestQueueContract("memory", () => memoryIngestQueue());
