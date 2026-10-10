import { openSqliteDb } from "../../src/adapters/node/sqlite-db.ts";
import { dbContract } from "../contract/db-contract.ts";

dbContract("SQLite (node:sqlite)", () => openSqliteDb(":memory:"));
