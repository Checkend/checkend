import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsBlobStore } from "../../src/adapters/node/fs-blob-store.ts";
import { memoryBlobStore, prefixedBlobStore } from "../../src/ports/blob-store.ts";
import { blobStoreContract } from "../contract/blob-store-contract.ts";

blobStoreContract("memory", () => memoryBlobStore());
blobStoreContract("prefixed (hosted install)", () =>
	prefixedBlobStore(memoryBlobStore(), "installs/abc/"),
);
blobStoreContract("file system (node:fs)", () =>
	fsBlobStore(mkdtempSync(join(tmpdir(), "checkend-blobs-"))),
);
