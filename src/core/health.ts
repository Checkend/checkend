import type { Ports } from "../ports/index.ts";
import { type MigrationLevel, migrationLevel } from "./migrations.ts";
import { VERSION } from "./version.ts";

export interface Health {
	status: "ok" | "error";
	version: string;
	/** Null when the database cannot be read. */
	migrations: MigrationLevel | null;
	time: string;
}

/** The state of this install. It never includes error details: `/health` is public. */
export async function checkHealth({ db, clock }: Ports): Promise<Health> {
	const time = clock.now().toISOString();
	try {
		return { status: "ok", version: VERSION, migrations: await migrationLevel(db), time };
	} catch {
		return { status: "error", version: VERSION, migrations: null, time };
	}
}
