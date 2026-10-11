import { sqliteVectorIndex } from "../../src/adapters/node/vector-index.ts";
import { vectorIndexContract } from "../contract/vector-index-contract.ts";
import { testPorts } from "../support/node-ports.ts";

vectorIndexContract("SQLite exact search (Node)", async () => {
	const { ports } = await testPorts();
	return { index: sqliteVectorIndex(ports.db), settle: async () => {} };
});
