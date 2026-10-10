import type { Ports } from "../ports/index.ts";
import { verifyFixes } from "./fixes.ts";
import { pruneDeliveries } from "./github.ts";
import { fetchDeployCommits } from "./github-commits.ts";
import { runRetention } from "./retention.ts";
import { deliverDue, reencryptSecrets } from "./webhooks.ts";

/**
 * Work on a schedule. One Cron Trigger (every 5 minutes) calls this; each job decides by the
 * time whether it runs (the Workers Free plan has 5 Cron Triggers per account). A job that
 * fails does not stop the other jobs.
 */
export interface ScheduledRun {
	/** Fixes verified (or checked again) in this run. */
	fixes_checked: number;
	/** Webhook delivery attempts in this run. */
	deliveries: number;
	errors: string[];
}

type Job = (ports: Ports, now: Date) => Promise<void>;

export async function runScheduled(ports: Ports, now: Date): Promise<ScheduledRun> {
	const run: ScheduledRun = { fixes_checked: 0, deliveries: 0, errors: [] };
	const jobs: [string, Job][] = [
		// Every run: the quiet period is in hours, so 5 minutes late is fine.
		[
			"verify_fixes",
			async (p, at) => {
				run.fixes_checked = await verifyFixes(p, at);
			},
		],
		// Webhook deliveries that are due (retries, and deliveries that the queue missed).
		[
			"deliver_webhooks",
			async (p) => {
				run.deliveries = await deliverDue(p);
			},
		],
		// Commits of new deploys from the GitHub API (with GITHUB_TOKEN).
		["fetch_deploy_commits", async (p) => void (await fetchDeployCommits(p))],
		// Rotation: secrets of an older key, encrypted again with the current key.
		["reencrypt_secrets", async (p) => void (await reencryptSecrets(p))],
		// Retention: a few chunks per run, so that a backlog goes away over several runs.
		["retention", async (p, at) => void (await runRetention(p, at))],
		// Once a day (the run between 03:00 and 03:05 UTC).
		[
			"prune_github_deliveries",
			async (p, at) => {
				if (at.getUTCHours() === 3 && at.getUTCMinutes() < 5) await pruneDeliveries(p, at);
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
