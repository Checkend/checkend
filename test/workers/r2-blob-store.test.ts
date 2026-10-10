import { env } from "cloudflare:test";
import { r2BlobStore } from "../../src/adapters/cloudflare/r2-blob-store.ts";
import { blobStoreContract } from "../contract/blob-store-contract.ts";

blobStoreContract("R2", () => r2BlobStore(env.BLOBS));
