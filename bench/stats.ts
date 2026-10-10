/** Helpers of the CPU benchmark (bench/run.ts): tail lines and percentiles. */

export interface Sample {
	/** The case: the "bench" query parameter of the request URL. */
	case: string;
	cpuMs: number;
	wallMs: number | null;
	status: number | null;
	outcome: string | null;
}

/**
 * One line of `wrangler tail --format json`: the case and the CPU time, or null for other lines.
 * CPU time is read from the known field names (cpuTime, CPUTimeMs).
 */
export function parseTailLine(line: string): Sample | null {
	let item: Record<string, unknown>;
	try {
		item = JSON.parse(line) as Record<string, unknown>;
	} catch {
		return null;
	}
	const event = item.event as
		| { request?: { url?: string }; response?: { status?: number } }
		| undefined;
	const url = event?.request?.url;
	if (!url) return null;
	const benchCase = new URL(url).searchParams.get("bench");
	const cpu = item.cpuTime ?? item.CPUTimeMs;
	if (!benchCase || typeof cpu !== "number") return null;
	const wall = item.wallTime ?? item.WallTimeMs;
	return {
		case: benchCase,
		cpuMs: cpu,
		wallMs: typeof wall === "number" ? wall : null,
		status: typeof event?.response?.status === "number" ? event.response.status : null,
		outcome: typeof item.outcome === "string" ? item.outcome : null,
	};
}

/** The value at a percentile (0 to 100) of sorted values; nearest rank. */
export function percentile(sorted: number[], p: number): number {
	if (sorted.length === 0) return Number.NaN;
	const rank = Math.ceil((p / 100) * sorted.length);
	return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

export interface CaseSummary {
	case: string;
	samples: number;
	p50: number;
	p99: number;
	max: number;
	/** Samples above the Workers Free plan limit of 10 ms. */
	over10ms: number;
	errors: number;
}

export function summarize(samples: Sample[]): CaseSummary[] {
	const byCase = new Map<string, Sample[]>();
	for (const sample of samples)
		byCase.set(sample.case, [...(byCase.get(sample.case) ?? []), sample]);
	return [...byCase.entries()]
		.map(([name, list]) => {
			const cpu = list.map((s) => s.cpuMs).sort((a, b) => a - b);
			return {
				case: name,
				samples: list.length,
				p50: percentile(cpu, 50),
				p99: percentile(cpu, 99),
				max: cpu.at(-1) ?? Number.NaN,
				over10ms: cpu.filter((ms) => ms > 10).length,
				errors: list.filter((s) => s.outcome !== "ok" || (s.status !== null && s.status >= 400))
					.length,
			};
		})
		.sort((a, b) => a.case.localeCompare(b.case));
}

/**
 * Joins the lines of a stream into JSON objects: `wrangler tail --format json` can print one
 * object over several lines. Text outside objects (status messages) is skipped.
 */
export function jsonObjects(onObject: (text: string) => void): (line: string) => void {
	let buffer = "";
	return (line) => {
		if (buffer === "" && !line.trimStart().startsWith("{")) return;
		buffer += `${line}\n`;
		try {
			JSON.parse(buffer);
		} catch {
			if (buffer.length > 4_000_000) buffer = "";
			return;
		}
		onObject(buffer);
		buffer = "";
	};
}
