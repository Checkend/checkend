import type { Db } from "../ports/db.ts";
import { sql } from "../ports/db.ts";

/**
 * Events over time, for the dashboard chart and the chart of an app. Live and 60 minutes come
 * from minute_counts (per project and minute, written by ingest); 24 hours and 7 days from
 * issue_counts (per issue and hour). Test issues are not in either (ingest does not count them).
 */

/** Hours of minute counts that retention keeps. */
export const MINUTE_COUNT_HOURS = 2;

export const SERIES_RANGES = ["live", "1h", "24h", "7d"] as const;
export type SeriesRange = (typeof SERIES_RANGES)[number];

const SHAPES: Record<SeriesRange, { unit: "minute" | "hour"; buckets: number }> = {
	live: { unit: "minute", buckets: 15 },
	"1h": { unit: "minute", buckets: 60 },
	"24h": { unit: "hour", buckets: 24 },
	"7d": { unit: "hour", buckets: 168 },
};

export interface Series {
	range: SeriesRange;
	unit: "minute" | "hour";
	/** The oldest first; `at` is the UTC minute ("2026-10-10T12:34") or hour ("2026-10-10T12"). */
	buckets: { at: string; n: number }[];
	total: number;
}

export const isSeriesRange = (value: unknown): value is SeriesRange =>
	typeof value === "string" && (SERIES_RANGES as readonly string[]).includes(value);

/** The events of all apps, or of one app (its public ID), in a range that ends now. */
export async function eventSeries(
	db: Db,
	now: Date,
	range: SeriesRange,
	appId: number | null = null,
): Promise<Series> {
	const { unit, buckets } = SHAPES[range];
	const step = unit === "minute" ? 60_000 : 3_600_000;
	const width = unit === "minute" ? 16 : 13;
	const keys = Array.from({ length: buckets }, (_, n) =>
		new Date(now.getTime() - (buckets - 1 - n) * step).toISOString().slice(0, width),
	);
	const from = keys[0] ?? "";
	const app = appId ?? -1;
	const rows =
		unit === "minute"
			? await db.all<{ at: string; n: number }>(
					sql`SELECT m.minute AS at, sum(m.count) AS n FROM minute_counts m
						JOIN projects p ON p.id = m.project_id
						WHERE m.minute >= ${from} AND p.deleted_at IS NULL
							AND (${app} = -1 OR p.public_id = ${app})
						GROUP BY m.minute`,
				)
			: await db.all<{ at: string; n: number }>(
					sql`SELECT c.hour AS at, sum(c.count) AS n FROM issue_counts c
						JOIN issues i ON i.id = c.issue_id JOIN projects p ON p.id = i.project_id
						WHERE c.hour >= ${from} AND i.test = 0 AND p.deleted_at IS NULL
							AND (${app} = -1 OR p.public_id = ${app})
						GROUP BY c.hour`,
				);
	const counts = new Map(rows.map((r) => [r.at, Number(r.n)]));
	const series = keys.map((at) => ({ at, n: counts.get(at) ?? 0 }));
	return { range, unit, buckets: series, total: series.reduce((sum, b) => sum + b.n, 0) };
}
