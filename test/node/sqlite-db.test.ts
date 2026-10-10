import { openSqliteDb } from "../../src/adapters/node/sqlite-db";
import { dbContract } from "../contract/db-contract";

dbContract("SQLite (node:sqlite)", () => openSqliteDb(":memory:"));
