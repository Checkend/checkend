import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordD1Bookmark } from "../../scripts/d1-bookmark.ts";

describe("D1 Time Travel bookmark before migrations", () => {
	it("reads the bookmark, prints the restore command, and keeps a log", () => {
		const log = join(mkdtempSync(join(tmpdir(), "checkend-bookmark-")), "bookmarks.jsonl");
		const calls: string[][] = [];
		const record = recordD1Bookmark({
			config: "wrangler.production.jsonc",
			log,
			run: (args) => {
				calls.push(args);
				return '⛅️ wrangler 4.149.0\n{\n  "bookmark": "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683",\n  "timestamp": "2026-10-10T12:00:00Z"\n}\n';
			},
		});
		expect(calls).toEqual([
			["d1", "time-travel", "info", "DB", "--json", "--config", "wrangler.production.jsonc"],
		]);
		expect(record.restore).toBe(
			"npx wrangler d1 time-travel restore DB --bookmark=00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683 --config wrangler.production.jsonc",
		);
		expect(JSON.parse(readFileSync(log, "utf8").trim())).toMatchObject({
			bookmark: record.bookmark,
			database: "DB",
		});
	});

	it("stops the deploy when there is no bookmark", () => {
		const log = join(mkdtempSync(join(tmpdir(), "checkend-bookmark-")), "b.jsonl");
		expect(() => recordD1Bookmark({ log, run: () => "Error: not logged in" })).toThrow(/no JSON/);
		expect(() => recordD1Bookmark({ log, run: () => '{"timestamp":"x"}' })).toThrow(
			/No Time Travel bookmark/,
		);
	});
});
