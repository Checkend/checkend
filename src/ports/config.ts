import type { EncryptionKey } from "../core/crypto.ts";

/** Settings of this install, from the environment. */
export interface Config {
	/** The admin bearer token for /v1. Null: the API rejects every request. */
	adminToken: string | null;
	/**
	 * The D1 daily limit of rows written (100,000 on the Workers Free plan). Null: no limit.
	 * Near the limit, ingest stores counters only (budget mode).
	 */
	dailyRowLimit: number | null;
	/** Stored events per issue. */
	eventsPerIssue: number;
	/** New issues per project per hour; more new fingerprints go to one "flood" issue. */
	newIssuesPerHour: number;
	/** Distinct tag keys per project. */
	tagKeysPerProject: number;
	/** Issue actions that need a human approval: "ignore", "merge". Empty: none (default). */
	requireApproval: string[];
	/** Hours without the error, after a deploy with the fix, before the fix is verified. */
	verifyQuietHours: number;
	/** The secret of the GitHub webhook (HMAC-SHA256). Null: the webhook is off (404). */
	githubWebhookSecret: string | null;
	/** Keys for encrypted values, the current key first (ENCRYPTION_KEYS). Empty: none. */
	encryptionKeys: EncryptionKey[];
	/** A GitHub token that can read the repositories (GITHUB_TOKEN): commits per release. */
	githubToken: string | null;
}

export const DEFAULT_CONFIG: Config = {
	adminToken: null,
	dailyRowLimit: null,
	eventsPerIssue: 100,
	newIssuesPerHour: 100,
	tagKeysPerProject: 200,
	requireApproval: [],
	verifyQuietHours: 24,
	githubWebhookSecret: null,
	encryptionKeys: [],
	githubToken: null,
};
