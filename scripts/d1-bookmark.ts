// A D1 Time Travel bookmark before migrations: the point to restore if a deploy goes wrong.
// Run alone:   node scripts/d1-bookmark.ts [--config wrangler.production.jsonc] [--database DB]
// In a deploy script, before `wrangler d1 migrations apply --remote`:
//   import { recordD1Bookmark } from "./d1-bookmark.ts";
//   await recordD1Bookmark({ config: "wrangler.production.jsonc" });
// It prints the bookmark and the restore command, and appends them to .wrangler/d1-bookmarks.jsonl
// (git-ignored). A failure stops the deploy: migrations without a way back are not run.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { parseArgs } from "node:util";

export interface BookmarkOptions {
	config?: string;
	database?: string;
	/** Runs wrangler and returns its standard output. Tests pass a fake. */
	run?: (args: string[]) => string;
	log?: string;
}

export interface Bookmark {
	bookmark: string;
	database: string;
	at: string;
	restore: string;
}

const defaultRun = (args: string[]) =>
	execFileSync("npx", ["wrangler", ...args], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});

/** The last JSON object in the output (wrangler can print other lines first). */
function lastJsonObject(output: string): Record<string, unknown> {
	for (
		let start = output.lastIndexOf("{");
		start >= 0;
		start = output.lastIndexOf("{", start - 1)
	) {
		try {
			const value = JSON.parse(output.slice(start)) as unknown;
			if (value && typeof value === "object" && !Array.isArray(value))
				return value as Record<string, unknown>;
		} catch {
			// not here: try an earlier "{"
		}
	}
	throw new Error("wrangler d1 time-travel info gave no JSON.");
}

export function recordD1Bookmark(options: BookmarkOptions = {}): Bookmark {
	const database = options.database ?? "DB";
	const configArgs = options.config ? ["--config", options.config] : [];
	const output = (options.run ?? defaultRun)([
		"d1",
		"time-travel",
		"info",
		database,
		"--json",
		...configArgs,
	]);
	const info = lastJsonObject(output);
	const bookmark = info.bookmark;
	if (typeof bookmark !== "string" || bookmark.length === 0) {
		throw new Error(
			"No Time Travel bookmark in the output: the deploy stops before the migrations.",
		);
	}
	const restore = [
		"npx wrangler d1 time-travel restore",
		database,
		`--bookmark=${bookmark}`,
		...configArgs,
	].join(" ");
	const record: Bookmark = { bookmark, database, at: new Date().toISOString(), restore };
	const log = options.log ?? ".wrangler/d1-bookmarks.jsonl";
	mkdirSync(log.slice(0, Math.max(0, log.lastIndexOf("/"))) || ".", { recursive: true });
	appendFileSync(log, `${JSON.stringify(record)}\n`);
	console.log(JSON.stringify({ message: "checkend: D1 bookmark before migrations", ...record }));
	return record;
}

if (process.argv[1]?.endsWith("d1-bookmark.ts")) {
	const { values } = parseArgs({
		options: { config: { type: "string" }, database: { type: "string" } },
	});
	recordD1Bookmark({
		...(values.config ? { config: values.config } : {}),
		...(values.database ? { database: values.database } : {}),
	});
}
