// A consistent copy of the SQLite database, also while Checkend runs (VACUUM INTO).
// Run: node scripts/backup.ts <target file>   (DATABASE_PATH: the database; default
// data/checkend.sqlite). In Docker: docker compose exec checkend node scripts/backup.ts /data/b.sqlite
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const source = process.env.DATABASE_PATH ?? "data/checkend.sqlite";
const target = process.argv[2];
if (!target) throw new Error("Usage: node scripts/backup.ts <target file>");
if (existsSync(target)) throw new Error(`${target} exists: choose a new file.`);
const database = new DatabaseSync(source, { readOnly: true });
// Wait for a write that is running, instead of failing.
database.exec("PRAGMA busy_timeout = 10000");
database.prepare("VACUUM INTO ?").run(target);
database.close();
console.log(JSON.stringify({ message: "checkend: backup written", target }));
