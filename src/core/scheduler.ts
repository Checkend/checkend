import type { Ports } from "../ports/index.ts";
import { verifyFixes } from "./fixes.ts";

/**
 * Work on a schedule. One Cron Trigger (every 5 minutes) calls this; each job decides by the
 * time whether it runs (the Workers Free plan has 5 Cron Triggers per account). A job that
 * fails does not stop the other jobs.
 */
export interface ScheduledRun {
	/** Fixes verified (or checked again) in this run. */
	fixes_checked: number;
	errors: string[];
}

type Job = (ports: Pick<Ports, "db" | "clock" | "config">, now: Date) => Promise<void>;

export async function runScheduled(
	ports: Pick<Ports, "db" | "clock" | "config">,
	now: Date,
): Promise<ScheduledRun> {
	const run: ScheduledRun = { fixes_checked: 0, errors: [] };
	const jobs: [string, Job][] = [
		// Every run: the quiet period is in hours, so 5 minutes late is fine.
		[
			"verify_fixes",
			async (p, at) => {
				run.fixes_checked = await verifyFixes(p, at);
			},
		],
	];
	for (const [name, job] of jobs) {
		try {
			await job(ports, now);
		} catch (error) {
			run.errors.push(`${name}: ${String(error).slice(0, 200)}`);
		}
	}
	if (run.errors.length > 0) {
		// Workers Logs. Checkend never reports its own errors to itself (AGENTS.md).
		console.error(
			JSON.stringify({ message: "checkend: scheduled job failed", errors: run.errors }),
		);
	}
	return run;
}
