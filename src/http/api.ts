import type { Context, Hono } from "hono";
import * as v from "valibot";
import { listActivity } from "../core/activity.ts";
import { ClaimBody, LimitQuery, MergeBody, NoteBody, SplitBody } from "../core/api-spec.ts";
import { addNote, claimIssue, issueTimeline, releaseClaim } from "../core/claims.ts";
import {
	DeployBody,
	FixOutcomeQuery,
	getRelease,
	LinkFixBody,
	linkFix,
	listFixOutcomes,
	listReleases,
	ReleaseListQuery,
	ReleaseQuery,
	recordDeploy,
} from "../core/fixes.ts";
import type { IngestState } from "../core/ingest/state.ts";
import { ingestStatus } from "../core/ingest-status.ts";
import {
	type ActionResult,
	decideApproval,
	listApprovals,
	mergeIssues,
	setIssueStatus,
	splitIssue,
} from "../core/issue-actions.ts";
import {
	CreateProjectBody,
	decodeCursor,
	EventListQuery,
	getEvent,
	getIssue,
	IdParam,
	IssueListQuery,
	listIssueEvents,
	listIssues,
	ProjectRef,
} from "../core/issues.ts";
import { LabelQuery, listLabels } from "../core/labels.ts";
import { createProject, listProjects, UpdateProjectBody, updateProject } from "../core/projects.ts";
import {
	deleteSourceMap,
	INDEX_CONTENT_TYPE,
	listProjectSourceMaps,
	MAX_SOURCEMAP_BYTES,
	SourceMapListQuery,
	SourceMapUploadQuery,
	uploadSourceMap,
} from "../core/sourcemaps.ts";
import { CreateTokenBody, createToken, listTokens, revokeToken } from "../core/tokens.ts";
import {
	CreateWebhookBody,
	createWebhook,
	deleteWebhook,
	listDeliveries,
	listWebhooks,
	pingWebhook,
	startDeliveries,
} from "../core/webhooks.ts";
import type { AppEnv } from "./app.ts";
import { need, requireActor } from "./auth.ts";

const invalid = (c: Context, issues: v.BaseIssue<unknown>[]) =>
	c.json(
		{
			error: "invalid_request",
			details: issues.map((issue) => ({ path: v.getDotPath(issue), message: issue.message })),
		},
		400,
	);

const dsn = (origin: string, key: string, projectId: number) => {
	const url = new URL(origin);
	return `${url.protocol}//${key}@${url.host}/${projectId}`;
};

/**
 * The JSON API, `/v1`. Each request needs `Authorization: Bearer <token>`: a scoped token,
 * or the bootstrap ADMIN_TOKEN secret. Each route needs a scope.
 */
export function apiRoutes(app: Hono<AppEnv>, state: IngestState): void {
	app.use("/v1/*", requireActor);

	app.get("/v1/tokens", need("admin"), async (c) =>
		c.json({ data: await listTokens(c.env.ports.db) }),
	);

	app.post("/v1/tokens", need("admin"), async (c) => {
		const body = v.safeParse(CreateTokenBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const { token, record } = await createToken(c.env.ports, c.get("actor"), body.output);
		return c.json({ data: { ...record, token } }, 201);
	});

	app.delete("/v1/tokens/:id", need("admin"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const revoked = await revokeToken(c.env.ports, c.get("actor"), params.output.id);
		return revoked ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/activity", need("admin"), async (c) => {
		const query = v.safeParse(LimitQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const rows = await listActivity(c.env.ports.db, query.output);
		return c.json({
			data: rows.map((row) => ({
				...row,
				data: row.data === null ? null : JSON.parse(String(row.data)),
			})),
		});
	});

	app.get("/v1/projects", need("issues:read"), async (c) => {
		const origin = new URL(c.req.url).origin;
		const projects = await listProjects(c.env.ports.db, c.env.ports.clock.now());
		return c.json({
			data: projects.map(({ keys, ...p }) => ({
				...p,
				dsns: keys.map((k) => dsn(origin, k, p.id)),
			})),
		});
	});

	app.post("/v1/projects", need("admin"), async (c) => {
		const body = v.safeParse(CreateProjectBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const project = await createProject(c.env.ports, body.output, c.get("actor"));
		const { publicKey, createdAt, internalId: _internal, ...rest } = project;
		return c.json(
			{
				data: {
					...rest,
					created_at: createdAt,
					dsn: dsn(new URL(c.req.url).origin, publicKey, project.id),
				},
			},
			201,
		);
	});

	app.patch("/v1/projects/:project", need("admin"), async (c) => {
		const ref = v.safeParse(ProjectRef, c.req.param("project"));
		if (!ref.success) return c.json({ error: "not_found" }, 404);
		const body = v.safeParse(UpdateProjectBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const found = await updateProject(c.env.ports, c.get("actor"), ref.output, body.output);
		if (!found) return c.json({ error: "not_found" }, 404);
		const origin = new URL(c.req.url).origin;
		const project = (await listProjects(c.env.ports.db, c.env.ports.clock.now())).find(
			(p) => p.slug === ref.output || String(p.id) === ref.output,
		);
		if (!project) return c.json({ error: "not_found" }, 404);
		const { keys, ...rest } = project;
		return c.json({ data: { ...rest, dsns: keys.map((k) => dsn(origin, k, rest.id)) } });
	});

	app.get("/v1/issues", need("issues:read"), async (c) => {
		const query = v.safeParse(IssueListQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const after = query.output.cursor ? decodeCursor(query.output.cursor) : null;
		if (query.output.cursor && !after) {
			return c.json(
				{ error: "invalid_request", details: [{ path: "cursor", message: "Invalid cursor" }] },
				400,
			);
		}
		const page = await listIssues(c.env.ports.db, query.output, after, c.env.ports.clock.now());
		if (page === "project_not_found") return c.json({ error: "project_not_found" }, 404);
		return c.json({ ...page, ingest: await ingestStatus(c.env.ports, state) });
	});

	app.get("/v1/issues/:id", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const issue = await getIssue(c.env.ports.db, params.output.id, c.env.ports.clock.now());
		return issue ? c.json({ data: issue }) : c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/issues/:id/events", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		const query = v.safeParse(EventListQuery, c.req.query());
		if (!params.success) return invalid(c, params.issues);
		if (!query.success) return invalid(c, query.issues);
		return c.json({
			data: await listIssueEvents(c.env.ports.db, params.output.id, query.output.limit),
		});
	});

	/** The HTTP response for an issue action. */
	const actionResponse = async (c: Context<AppEnv>, issueId: number, result: ActionResult) => {
		switch (result.kind) {
			case "done":
				return c.json({ data: await getIssue(c.env.ports.db, issueId, c.env.ports.clock.now()) });
			case "approval_required":
				return c.json({ status: "approval_required", approval_id: result.approvalId }, 202);
			case "not_found":
				return c.json({ error: "not_found" }, 404);
			case "invalid":
				return c.json(
					{ error: "invalid_request", details: [{ path: "source_ids", message: result.message }] },
					400,
				);
		}
	};

	for (const [path, status] of [
		["resolve", "resolved"],
		["ignore", "ignored"],
		["unresolve", "unresolved"],
	] as const) {
		app.post(`/v1/issues/:id/${path}`, need("issues:write"), async (c) => {
			const params = v.safeParse(IdParam, c.req.param());
			if (!params.success) return invalid(c, params.issues);
			const result = await setIssueStatus(c.env.ports, c.get("actor"), params.output.id, status);
			return actionResponse(c, params.output.id, result);
		});
	}

	app.post("/v1/issues/:id/merge", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const body = v.safeParse(MergeBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await mergeIssues(
			c.env.ports,
			c.get("actor"),
			params.output.id,
			body.output.source_ids,
		);
		return actionResponse(c, params.output.id, result);
	});

	app.post("/v1/issues/:id/claim", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const body = v.safeParse(ClaimBody, (await c.req.json().catch(() => ({}))) ?? {});
		if (!body.success) return invalid(c, body.issues);
		const result = await claimIssue(
			c.env.ports,
			c.get("actor"),
			params.output.id,
			body.output.minutes,
		);
		if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.kind === "claimed") return c.json({ error: "claimed", claim: result.claim }, 409);
		return c.json({
			data: await getIssue(c.env.ports.db, params.output.id, c.env.ports.clock.now()),
		});
	});

	// Release a claim: POST /release, or DELETE /claim (the same action).
	const release = async (c: Context<AppEnv>) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const result = await releaseClaim(c.env.ports, c.get("actor"), params.output.id);
		if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.kind === "not_holder")
			return c.json({ error: "not_claim_holder", claim: result.claim }, 403);
		return c.json({
			data: await getIssue(c.env.ports.db, params.output.id, c.env.ports.clock.now()),
		});
	};
	app.post("/v1/issues/:id/release", need("issues:write"), release);
	app.delete("/v1/issues/:id/claim", need("issues:write"), release);

	app.post("/v1/issues/:id/notes", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const body = v.safeParse(NoteBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const id = await addNote(c.env.ports, c.get("actor"), params.output.id, body.output.text);
		if (id === null) return c.json({ error: "not_found" }, 404);
		return c.json({ data: { id } }, 201);
	});

	app.get("/v1/issues/:id/activity", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		const query = v.safeParse(LimitQuery, c.req.query());
		if (!params.success) return invalid(c, params.issues);
		if (!query.success) return invalid(c, query.issues);
		return c.json({ data: await issueTimeline(c.env.ports, params.output.id, query.output.limit) });
	});

	app.post("/v1/issues/:id/split", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const body = v.safeParse(SplitBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await splitIssue(
			c.env.ports,
			c.get("actor"),
			params.output.id,
			body.output.event_ids,
		);
		if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.kind === "invalid") {
			return c.json(
				{ error: "invalid_request", details: [{ path: "event_ids", message: result.message }] },
				400,
			);
		}
		return c.json(
			{ data: await getIssue(c.env.ports.db, result.newIssueId, c.env.ports.clock.now()) },
			201,
		);
	});

	app.post("/v1/issues/:id/fix", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const body = v.safeParse(LinkFixBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await linkFix(c.env.ports, c.get("actor"), params.output.id, body.output);
		if (result === "not_found") return c.json({ error: "not_found" }, 404);
		if (typeof result === "object") {
			return c.json(
				{ error: "invalid_request", details: [{ path: "pr_url", message: result.invalid }] },
				400,
			);
		}
		return c.json({
			data: await getIssue(c.env.ports.db, params.output.id, c.env.ports.clock.now()),
		});
	});

	app.post("/v1/deploys", need("releases:write"), async (c) => {
		const body = v.safeParse(DeployBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await recordDeploy(c.env.ports, c.get("actor"), body.output);
		if (result === "project_not_found") return c.json({ error: "project_not_found" }, 404);
		return c.json({ data: result }, 201);
	});

	app.get("/v1/releases", need("issues:read"), async (c) => {
		const query = v.safeParse(ReleaseListQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const releases = await listReleases(c.env.ports.db, query.output);
		if (releases === "project_not_found") return c.json({ error: "project_not_found" }, 404);
		return c.json({ data: releases });
	});

	app.get("/v1/releases/:version", need("issues:read"), async (c) => {
		const query = v.safeParse(ReleaseQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const version = c.req.param("version");
		const release = await getRelease(c.env.ports.db, query.output.project, version);
		return release ? c.json({ data: release }) : c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/fix-outcomes", need("admin"), async (c) => {
		const query = v.safeParse(FixOutcomeQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		return c.json({
			data: await listFixOutcomes(c.env.ports.db, query.output, c.env.ports.clock.now()),
		});
	});

	app.post("/v1/sourcemaps", need("releases:write"), async (c) => {
		const query = v.safeParse(SourceMapUploadQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const type = (c.req.header("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
		if (type !== "application/json" && type !== INDEX_CONTENT_TYPE) {
			return c.json(
				{
					error: "unsupported_media_type",
					reason: `Use application/json or ${INDEX_CONTENT_TYPE}.`,
				},
				415,
			);
		}
		const tooLarge = () =>
			c.json({ error: "payload_too_large", max_bytes: MAX_SOURCEMAP_BYTES }, 413);
		if (Number(c.req.header("content-length") ?? 0) > MAX_SOURCEMAP_BYTES) return tooLarge();
		const body = new Uint8Array(await c.req.arrayBuffer());
		if (body.byteLength > MAX_SOURCEMAP_BYTES) return tooLarge();
		const result = await uploadSourceMap(
			c.env.ports,
			c.get("actor"),
			query.output,
			body,
			type === INDEX_CONTENT_TYPE,
		);
		switch (result.kind) {
			case "storage_not_configured":
				return c.json(
					{
						error: "storage_not_configured",
						reason: "Bind an R2 bucket as BLOBS: Checkend stores source maps there.",
					},
					400,
				);
			case "project_not_found":
				return c.json({ error: "project_not_found" }, 404);
			case "invalid":
				return c.json({ error: "invalid_sourcemap", reason: result.message }, 400);
			case "done":
				return c.json({ data: result.sourcemap }, 201);
		}
	});

	app.get("/v1/sourcemaps", need("issues:read"), async (c) => {
		const query = v.safeParse(SourceMapListQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		const maps = await listProjectSourceMaps(
			c.env.ports.db,
			query.output.project,
			query.output.release ?? null,
		);
		return maps ? c.json({ data: maps }) : c.json({ error: "project_not_found" }, 404);
	});

	app.delete("/v1/sourcemaps/:id", need("releases:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const deleted = await deleteSourceMap(c.env.ports, c.get("actor"), params.output.id);
		return deleted
			? c.json({ data: { id: params.output.id, deleted: true } })
			: c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/webhooks", need("admin"), async (c) =>
		c.json({ data: await listWebhooks(c.env.ports.db) }),
	);

	app.post("/v1/webhooks", need("admin"), async (c) => {
		const body = v.safeParse(CreateWebhookBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const result = await createWebhook(c.env.ports, c.get("actor"), body.output);
		if (result.kind === "encryption_not_configured") {
			return c.json(
				{
					error: "encryption_not_configured",
					reason: "Set ENCRYPTION_KEYS: Checkend stores the signing secret encrypted.",
				},
				400,
			);
		}
		if (result.kind === "invalid") {
			return c.json(
				{ error: "invalid_request", details: [{ path: result.path, message: result.message }] },
				400,
			);
		}
		return c.json({ data: result.webhook }, 201);
	});

	app.delete("/v1/webhooks/:id", need("admin"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const deleted = await deleteWebhook(c.env.ports, c.get("actor"), params.output.id);
		return deleted
			? c.json({ data: { id: params.output.id, deleted: true } })
			: c.json({ error: "not_found" }, 404);
	});

	app.post("/v1/webhooks/:id/test", need("admin"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const deliveryId = await pingWebhook(c.env.ports, params.output.id);
		if (deliveryId === null) return c.json({ error: "not_found" }, 404);
		await startDeliveries(c.env.ports);
		return c.json({ data: { delivery_id: deliveryId } }, 202);
	});

	app.get("/v1/webhooks/:id/deliveries", need("admin"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		const query = v.safeParse(LimitQuery, c.req.query());
		if (!params.success) return invalid(c, params.issues);
		if (!query.success) return invalid(c, query.issues);
		return c.json({
			data: await listDeliveries(c.env.ports.db, params.output.id, query.output.limit),
		});
	});

	app.get("/v1/labels", need("admin"), async (c) => {
		const query = v.safeParse(LabelQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		return c.json({
			data: await listLabels(c.env.ports.db, query.output, c.env.ports.clock.now()),
		});
	});

	app.get("/v1/approvals", need("admin"), async (c) => {
		const query = v.safeParse(LimitQuery, c.req.query());
		if (!query.success) return invalid(c, query.issues);
		return c.json({ data: await listApprovals(c.env.ports, query.output.limit) });
	});

	for (const decision of ["approve", "reject"] as const) {
		app.post(`/v1/approvals/:id/${decision}`, need("admin"), async (c) => {
			const params = v.safeParse(IdParam, c.req.param());
			if (!params.success) return invalid(c, params.issues);
			const result = await decideApproval(c.env.ports, c.get("actor"), params.output.id, decision);
			if (result === "not_found") return c.json({ error: "not_found" }, 404);
			if (result === "not_pending") return c.json({ error: "approval_not_pending" }, 409);
			if (typeof result === "object") {
				return c.json({ error: "approval_failed", reason: result.failed }, 409);
			}
			if (result === "own_request") {
				return c.json(
					{ error: "forbidden", reason: "A requester cannot approve its own request." },
					403,
				);
			}
			return c.json({ data: { id: params.output.id, decision } });
		});
	}

	app.get("/v1/events/:id", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const event = await getEvent(c.env.ports.db, params.output.id);
		return event ? c.json({ data: event }) : c.json({ error: "not_found" }, 404);
	});
}
