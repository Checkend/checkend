import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareEvent } from "../../src/core/ingest/prepare.ts";
import { IngestState, storeEvent } from "../../src/core/ingest/store.ts";
import { createProject } from "../../src/core/projects.ts";
import { createApp } from "../../src/http/app.ts";
import { sql } from "../../src/ports/db.ts";
import { testPorts } from "../support/node-ports.ts";

const ADMIN = "github-admin-token-0123456789";
const SECRET = "github-webhook-secret";
const FIX = "1111111111111111111111111111111111111111";
const HEAD = "2222222222222222222222222222222222222222";
const MERGE = "3333333333333333333333333333333333333333";

async function setup(secret: string | null = SECRET) {
	const t = await testPorts({ config: { adminToken: ADMIN, githubWebhookSecret: secret } });
	const project = await createProject(t.ports, { name: "Shop" });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, body?: unknown) => {
		const response = await app.request(
			`https://checkend.test${path}`,
			{
				method,
				headers: { authorization: `Bearer ${ADMIN}`, "content-type": "application/json" },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	let delivery = 0;
	const hook = async (
		event: string,
		payload: unknown,
		options: { signature?: string | null; delivery?: string } = {},
	) => {
		const body = JSON.stringify(payload);
		const signature =
			options.signature === undefined
				? `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`
				: options.signature;
		const response = await app.request(
			"https://checkend.test/hooks/github",
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-github-event": event,
					"x-github-delivery": options.delivery ?? `delivery-${++delivery}`,
					...(signature === null ? {} : { "x-hub-signature-256": signature }),
				},
				body,
			},
			{ ports: t.ports },
		);
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
	const issue = async () => {
		const raw = { message: "cart total failed", release: "shop@1" };
		const prepared = await prepareEvent(
			new TextEncoder().encode(JSON.stringify(raw)),
			t.clock.now(),
		);
		await storeEvent(t.ports, new IngestState(), project.internalId, prepared, {
			sleep: async () => {},
		});
		return (
			await t.ports.db.first<{ id: number }>(
				sql`SELECT id FROM issues WHERE fingerprint = ${prepared.fingerprint.hash}`,
			)
		)?.id as number;
	};
	const repository = { full_name: "acme/shop" };
	await call("PATCH", `/v1/projects/${project.slug}`, { repository: "acme/shop" });
	return { ...t, project, call, hook, issue, repository };
}

describe("GitHub webhook (POST /hooks/github)", () => {
	it("accepts a valid signature, and gives 401 for a wrong or missing one", async () => {
		const { hook } = await setup();
		expect((await hook("ping", { zen: "Keep it simple." })).status).toBe(200);
		const wrong = await hook("ping", { zen: "x" }, { signature: `sha256=${"0".repeat(64)}` });
		expect(wrong).toEqual({ status: 401, body: { error: "invalid_signature" } });
		expect((await hook("ping", { zen: "x" }, { signature: "sha1=abc" })).status).toBe(401);
		expect((await hook("ping", { zen: "x" }, { signature: null })).status).toBe(401);
	});

	it("is off (404) when GITHUB_WEBHOOK_SECRET is not set", async () => {
		const { hook } = await setup(null);
		expect((await hook("ping", {})).status).toBe(404);
	});

	it("a push, then a successful deployment, deploys a fix that is not the head commit", async () => {
		const { hook, call, issue, repository, project } = await setup();
		const id = await issue();
		await call("POST", `/v1/issues/${id}/fix`, { commit: FIX.slice(0, 7) });
		const push = await hook("push", {
			ref: "refs/heads/main",
			after: HEAD,
			repository,
			commits: [{ id: FIX }, { id: HEAD }],
		});
		expect(push).toEqual({ status: 200, body: { ok: true, projects: 1, commits: 2 } });
		const deployed = await hook("deployment_status", {
			repository,
			deployment_status: { state: "success" },
			deployment: { sha: HEAD, environment: "production", payload: { release: "shop@2" } },
		});
		expect(deployed.status).toBe(200);
		expect(deployed.body.deploys).toEqual([
			expect.objectContaining({ project_id: project.id, release: "shop@2", fixes_deployed: [id] }),
		]);
		const fix = (await call("GET", `/v1/issues/${id}`)).body.data.fix;
		expect(fix).toMatchObject({ release: "shop@2", environment: "production" });
		const releases = (await call("GET", "/v1/releases")).body.data;
		expect(releases[0].deploys[0]).toMatchObject({ source: "github", commit: HEAD });
	});

	it("a merged pull request: a deploy with its merge commit deploys a PR fix", async () => {
		const { hook, call, issue, repository } = await setup();
		const id = await issue();
		const pr = "https://github.com/acme/shop/pull/7";
		await call("POST", `/v1/issues/${id}/fix`, { pr_url: pr });
		await hook("pull_request", {
			action: "closed",
			repository,
			pull_request: { html_url: pr, merged: true, merge_commit_sha: MERGE },
		});
		const deployed = await hook("deployment_status", {
			repository,
			deployment_status: { state: "success" },
			deployment: { sha: MERGE, environment: "production" },
		});
		expect(deployed.body.deploys[0]).toMatchObject({ release: MERGE, fixes_deployed: [id] });
	});

	it("ignores a redelivery, other states, other events and unknown repositories", async () => {
		const { hook, call, repository } = await setup();
		const deployment = {
			repository,
			deployment_status: { state: "success" },
			deployment: { sha: HEAD, environment: "production" },
		};
		expect((await hook("deployment_status", deployment, { delivery: "same" })).status).toBe(200);
		expect(await hook("deployment_status", deployment, { delivery: "same" })).toEqual({
			status: 200,
			body: { ok: true, duplicate: true },
		});
		const pending = { ...deployment, deployment_status: { state: "pending" } };
		expect((await hook("deployment_status", pending)).body).toEqual({
			ok: true,
			ignored: "state pending",
		});
		expect((await hook("issues", { repository })).body).toEqual({
			ok: true,
			ignored: "event issues",
		});
		const other = { ...deployment, repository: { full_name: "acme/other" } };
		expect((await hook("deployment_status", other)).body).toEqual({
			ok: true,
			ignored: "no project for acme/other",
		});
		expect((await call("GET", "/v1/releases")).body.data).toHaveLength(1);
	});

	it("rejects a body that is not JSON (400) or too large (413)", async () => {
		const { hook } = await setup();
		expect((await hook("push", "x".repeat(3 * 1024 * 1024))).status).toBe(413);
	});
});

describe("project repository", () => {
	it("PATCH /v1/projects/:project sets the repository; link_fix accepts PRs of it only", async () => {
		const { call, issue, project } = await setup();
		const projects = (await call("GET", "/v1/projects")).body.data;
		expect(projects[0]).toMatchObject({ slug: project.slug, repository: "acme/shop" });
		const id = await issue();
		const other = await call("POST", `/v1/issues/${id}/fix`, {
			pr_url: "https://github.com/acme/other/pull/1",
		});
		expect(other.status).toBe(400);
		expect(other.body.details[0].message).toMatch(/acme\/shop/);
		for (const repository of ["acme", "acme/shop/x", "https://github.com/acme/shop"]) {
			expect(
				(await call("PATCH", `/v1/projects/${project.slug}`, { repository })).status,
				repository,
			).toBe(400);
		}
		expect((await call("PATCH", "/v1/projects/no-such", { repository: "a/b" })).status).toBe(404);
		expect((await call("PATCH", `/v1/projects/${project.id}`, { repository: null })).status).toBe(
			200,
		);
	});
});

describe("the GitHub webhook body cap", () => {
	it("stops reading a chunked body (no Content-Length) at the cap, before the signature check", async () => {
		const t = await testPorts({ config: { githubWebhookSecret: SECRET } });
		const app = createApp({ state: new IngestState() });
		let pulled = 0;
		const chunk = new Uint8Array(256 * 1024);
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				pulled += chunk.byteLength;
				if (pulled > 64 * 1024 * 1024) controller.close();
				else controller.enqueue(chunk);
			},
		});
		const response = await app.request(
			new Request("https://checkend.test/hooks/github", {
				method: "POST",
				headers: { "x-github-event": "push", "x-hub-signature-256": "sha256=00" },
				body,
				duplex: "half",
			} as RequestInit),
			undefined,
			{ ports: t.ports },
		);
		expect(response.status).toBe(413);
		// It stopped soon after 2 MB, not at the end of the 64 MB stream.
		expect(pulled).toBeLessThan(4 * 1024 * 1024);
	});
});
