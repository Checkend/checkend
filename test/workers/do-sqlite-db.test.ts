import { env, runInDurableObject } from "cloudflare:test";
import { durableObjectDb } from "../../src/adapters/cloudflare/do-sqlite-db.ts";
import type { Db, Statement } from "../../src/ports/db.ts";
import { dbContract } from "../contract/db-contract.ts";
import { migrationsContract } from "../contract/migrations-contract.ts";

/**
 * A Db whose every call runs inside one Durable Object (its storage is usable only there).
 * Each test gets a new object, so a new empty database.
 */
function objectDb(name: string): Db {
	const stub = env.TEST_SQL.get(env.TEST_SQL.idFromName(name));
	const inObject = <T>(run: (db: Db) => Promise<T>) =>
		runInDurableObject(stub, (_instance, state) => run(durableObjectDb(state.storage)));
	return {
		all: (s: Statement) => inObject((db) => db.all(s)),
		first: (s: Statement) => inObject((db) => db.first(s)),
		run: (s: Statement) => inObject((db) => db.run(s)),
		batch: (s: readonly Statement[]) => inObject((db) => db.batch(s)),
	} as Db;
}

let n = 0;
dbContract("Durable Object SQLite (workerd)", () => objectDb(`db-${++n}`));
migrationsContract(
	"Durable Object SQLite (workerd)",
	async () => objectDb(`migrations-${++n}`),
	() => env.TEST_MIGRATIONS,
);
