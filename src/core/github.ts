import * as v from "valibot";
import { sql } from "../ports/db.ts";
import type { Ports } from "../ports/index.ts";
import { type DeployResult, recordDeploy } from "./fixes.ts";
import type { Actor } from "./tokens.ts";

/**
 * The GitHub webhook. GitHub signs each delivery with the webhook secret (HMAC-SHA256 of the
 * body, header X-Hub-Signature-256). Events:
 * - push: the commits of a branch, so that a deploy of the head contains the earlier commits;
 * - pull_request (closed, merged): the merge commit, so that a deploy with it contains the PR;
 * - deployment_status (success): a deploy of the commit (release: deployment.payload.release,
 *   or the commit SHA).
 * The repository (owner/name) selects the projects: each project with that repository.
 */

/** The largest webhook body that Checkend reads. */
export const MAX_WEBHOOK_BYTES = 2 * 1024 * 1024;

/** Commits per push that Checkend stores. */
const MAX_PUSH_COMMITS = 1000;

/** Days that Checkend keeps delivery IDs, to ignore redeliveries. */
export const DELIVERY_DAYS = 7;

export const GITHUB_ACTOR: Actor = { type: "system", id: null, name: "github", scopes: [] };

const encoder = new TextEncoder();

/** True when `header` is "sha256=<hex>" and matches the body. The check takes constant time. */
export async function verifyGithubSignature(
	secret: string,
	body: Uint8Array<ArrayBuffer>,
	header: string | null,
): Promise<boolean> {
	const hex = /^sha256=([0-9a-f]{64})$/.exec(header ?? "")?.[1];
	if (!hex) return false;
	const signature = new Uint8Array(
		hex.match(/../g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
	);
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	);
	return crypto.subtle.verify("HMAC", key, signature, body);
}

const Sha = v.pipe(
	v.string(),
	v.regex(/^[0-9a-fA-F]{40}$/),
	v.transform((sha) => sha.toLowerCase()),
);
const Repository = v.object({ full_name: v.pipe(v.string(), v.maxLength(200)) });

const PushPayload = v.object({
	ref: v.pipe(v.string(), v.maxLength(300)),
	deleted: v.optional(v.boolean()),
	repository: Repository,
	commits: v.array(v.object({ id: Sha })),
});
const PullRequestPayload = v.object({
	action: v.string(),
	repository: Repository,
	pull_request: v.object({
		html_url: v.pipe(v.string(), v.maxLength(300)),
		merged: v.optional(v.nullable(v.boolean())),
		merge_commit_sha: v.optional(v.nullable(Sha)),
	}),
});
const DeploymentStatusPayload = v.object({
	repository: Repository,
	deployment_status: v.object({ state: v.string() }),
	deployment: v.object({
		sha: Sha,
		environment: v.pipe(v.string(), v.minLength(1), v.maxLength(200)),
		payload: v.optional(v.unknown()),
	}),
});

export type WebhookResult =
	| { ok: true; duplicate: true }
	| { ok: true; ignored: string }
	| { ok: true; projects: number; commits: number }
	| { ok: true; projects: number; merged: string }
	| { ok: true; deploys: DeployResult[] }
	| { error: "invalid_payload"; message: string };

type P = Pick<Ports, "db" | "clock" | "config">;

/**
 * Handles one verified delivery. A delivery ID that came before is a redelivery: no change.
 * When the handling fails, the ID is removed, so that GitHub can deliver it again.
 */
export async function handleGithubEvent(
	ports: P,
	event: string,
	delivery: string,
	payload: unknown,
): Promise<WebhookResult> {
	if (event === "ping") return { ok: true, ignored: "event ping" };
	if (!["push", "pull_request", "deployment_status"].includes(event)) {
		return { ok: true, ignored: `event ${event.slice(0, 50)}` };
	}
	if (delivery) {
		const inserted = await ports.db.run(
			sql`INSERT OR IGNORE INTO github_deliveries (id, event, received_at)
				VALUES (${delivery}, ${event}, ${ports.clock.now().toISOString()})`,
		);
		if (inserted.changes === 0) return { ok: true, duplicate: true };
	}
	const forget = () => ports.db.run(sql`DELETE FROM github_deliveries WHERE id = ${delivery}`);
	try {
		const result = await handleEvent(ports, event, payload);
		if ("error" in result) await forget();
		return result;
	} catch (error) {
		await forget().catch(() => {});
		throw error;
	}
}

async function handleEvent(ports: P, event: string, payload: unknown): Promise<WebhookResult> {
	const nowIso = ports.clock.now().toISOString();
	const repository = v.safeParse(v.object({ repository: Repository }), payload);
	if (!repository.success) return { error: "invalid_payload", message: "repository is missing" };
	const name = repository.output.repository.full_name.toLowerCase();
	const projects = await ports.db.all<{ id: number; slug: string }>(
		sql`SELECT id, slug FROM projects WHERE repository = ${name} ORDER BY id`,
	);
	if (projects.length === 0) return { ok: true, ignored: `no project for ${name}` };

	if (event === "push") {
		const push = v.safeParse(PushPayload, payload);
		if (!push.success) return invalid(push.issues);
		const branch = /^refs\/heads\/(.+)$/.exec(push.output.ref)?.[1];
		if (!branch || push.output.deleted) return { ok: true, ignored: "not a branch push" };
		const commits = JSON.stringify(push.output.commits.slice(-MAX_PUSH_COMMITS).map((c) => c.id));
		await ports.db.batch(
			projects.map(
				(project) =>
					sql`INSERT INTO pushed_commits (project_id, branch, sha, pushed_at)
						SELECT ${project.id}, ${branch}, value, ${nowIso} FROM json_each(${commits})`,
			),
		);
		return {
			ok: true,
			projects: projects.length,
			commits: Math.min(push.output.commits.length, MAX_PUSH_COMMITS),
		};
	}

	if (event === "pull_request") {
		const pr = v.safeParse(PullRequestPayload, payload);
		if (!pr.success) return invalid(pr.issues);
		const { action, pull_request } = pr.output;
		const sha = pull_request.merge_commit_sha;
		if (action !== "closed" || !pull_request.merged || !sha) {
			return { ok: true, ignored: "not a merged pull request" };
		}
		const prUrl = pull_request.html_url;
		if (!prUrl.toLowerCase().startsWith(`https://github.com/${name}/pull/`)) {
			return {
				error: "invalid_payload",
				message: "html_url is not a pull request of the repository",
			};
		}
		await ports.db.batch(
			projects.map(
				(project) =>
					sql`INSERT INTO pr_merges (project_id, pr_url, merge_sha, merged_at)
						VALUES (${project.id}, ${prUrl}, ${sha}, ${nowIso})
						ON CONFLICT (project_id, pr_url) DO UPDATE SET merge_sha = excluded.merge_sha`,
			),
		);
		return { ok: true, projects: projects.length, merged: prUrl };
	}

	const status = v.safeParse(DeploymentStatusPayload, payload);
	if (!status.success) return invalid(status.issues);
	const { deployment, deployment_status } = status.output;
	if (deployment_status.state !== "success") {
		return { ok: true, ignored: `state ${deployment_status.state.slice(0, 50)}` };
	}
	const release = v.safeParse(
		v.object({ release: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(200)) }),
		deployment.payload,
	);
	const deploys: DeployResult[] = [];
	for (const project of projects) {
		const result = await recordDeploy(
			ports,
			GITHUB_ACTOR,
			{
				project: project.slug,
				commit: deployment.sha,
				release: release.success ? release.output.release : undefined,
				environment: deployment.environment,
				commits: [],
				pull_requests: [],
			},
			"github",
		);
		if (result !== "project_not_found") deploys.push(result);
	}
	return { ok: true, deploys };
}

const invalid = (issues: v.BaseIssue<unknown>[]): WebhookResult => ({
	error: "invalid_payload",
	message: issues
		.slice(0, 3)
		.map((issue) => `${v.getDotPath(issue) ?? "body"}: ${issue.message}`)
		.join("; "),
});

/** Deletes delivery IDs older than DELIVERY_DAYS. */
export async function pruneDeliveries(ports: Pick<Ports, "db">, now: Date): Promise<void> {
	const before = new Date(now.getTime() - DELIVERY_DAYS * 86_400_000).toISOString();
	await ports.db.run(sql`DELETE FROM github_deliveries WHERE received_at < ${before}`);
}
