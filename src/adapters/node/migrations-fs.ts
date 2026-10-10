import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Migration } from "../../core/migrations.ts";

/** Reads the `.sql` files of a migrations folder in name order. */
export function readMigrations(dir: string): Migration[] {
	return readdirSync(dir)
		.filter((name) => name.endsWith(".sql"))
		.sort()
		.map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}
