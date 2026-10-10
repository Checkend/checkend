import { env } from "cloudflare:test";
import { d1Db } from "../../src/adapters/cloudflare/d1-db.ts";
import { dbContract } from "../contract/db-contract.ts";

dbContract("D1 (workerd)", () => d1Db(env.DB));
