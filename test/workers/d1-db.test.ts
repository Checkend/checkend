import { env } from "cloudflare:test";
import { d1Db } from "../../src/adapters/cloudflare/d1-db";
import { dbContract } from "../contract/db-contract";

dbContract("D1 (workerd)", () => d1Db(env.DB));
