import type { Series, SeriesRange } from "../../../core/series.ts";
import { count, type Html, h } from "../html.ts";

/**
 * The events chart of the dashboard and of an app: one bar per minute or hour, drawn on the
 * server (no script needed). In the Live view, the client script asks the series route every
 * 10 seconds while the page is visible and moves the bars (data-live). No inline style: the
 * bars have SVG attributes only.
 */

const RANGES: [SeriesRange, string][] = [
	["live", "Live"],
	["1h", "60 min"],
	["24h", "24 h"],
	["7d", "7 days"],
];

const WIDTH = 720;
const HEIGHT = 140;

/** The label of a bucket: "12:03 UTC", or "Oct 10, 14:00 UTC" for hours. */
export function bucketLabel(at: string, unit: Series["unit"]): string {
	const date = new Date(unit === "minute" ? `${at}:00Z` : `${at}:00:00Z`);
	const hm = date.toISOString().slice(11, 16);
	if (unit === "minute") return `${hm} UTC`;
	const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
	return `${day}, ${hm} UTC`;
}

const plural = (n: number) => `${count(n)} ${n === 1 ? "event" : "events"}`;

function bars(series: Series): Html {
	const n = series.buckets.length;
	const slot = WIDTH / n;
	const gap = n > 60 ? 0.5 : 2;
	const max = Math.max(1, ...series.buckets.map((b) => b.n));
	return h`${series.buckets.map((b, i) => {
		const height = b.n === 0 ? 0 : Math.max(2, (b.n / max) * (HEIGHT - 4));
		return h`<rect x="${(i * slot + gap / 2).toFixed(1)}" y="${(HEIGHT - height).toFixed(1)}" width="${Math.max(1, slot - gap).toFixed(1)}" height="${height.toFixed(1)}" rx="1.5"><title>${bucketLabel(b.at, series.unit)}: ${plural(b.n)}</title></rect>`;
	})}`;
}

/**
 * The chart card. `href`: the page that the range links go to ("/" or the app page), with its
 * other query values; `appId`: the app of the chart, or null for all apps.
 */
export function chartCard(
	series: Series,
	href: (range: SeriesRange) => string,
	appId: number | null,
): Html {
	const first = series.buckets[0];
	const live = series.range === "live";
	// Only the query: the client script adds the base path and the route (no URL in the page).
	const source = `range=live${appId === null ? "" : `&app=${appId}`}`;
	return h`<section class="card chart-card" aria-labelledby="chart-title">
<div class="chart-head">
<h2 id="chart-title">Events <span class="chart-total" data-chart-total>${plural(series.total)}</span></h2>
<nav class="segmented" aria-label="Time range">${RANGES.map(
		([range, label]) =>
			h`<a href="${href(range)}"${range === series.range ? h` aria-current="true"` : ""}>${range === "live" ? h`<span class="live-dot" aria-hidden="true"></span>` : ""}${label}</a>`,
	)}</nav>
</div>
<svg class="chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" preserveAspectRatio="none" role="img" aria-label="Events per ${series.unit}: ${plural(series.total)}"${live ? h` data-live="${source}"` : ""}>${bars(series)}</svg>
<div class="chart-axis" aria-hidden="true"><span>${first ? bucketLabel(first.at, series.unit) : ""}</span><span>${live ? "now, updates every 10 s" : "now"}</span></div>
</section>`;
}

/** A 24-hour sparkline. Decorative: the row has the number as text. */
export function sparkline(values: number[]): Html {
	const width = 96;
	const height = 22;
	const max = Math.max(1, ...values);
	const step = width / Math.max(1, values.length - 1);
	const points = values
		.map((v, n) => `${(n * step).toFixed(1)},${(height - 1 - (v / max) * (height - 2)).toFixed(1)}`)
		.join(" ");
	return h`<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true" focusable="false"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
