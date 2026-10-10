import type { Context, Hono } from "hono";
import * as v from "valibot";
import { listActivity } from "../core/activity.ts";
import { ClaimBody, LimitQuery, MergeBody, NoteBody } from "../core/api-spec.ts";
import { addNote, claimIssue, issueTimeline, releaseClaim } from "../core/claims.ts";
import type { IngestState } from "../core/ingest/state.ts";
import { ingestStatus } from "../core/ingest-status.ts";
import {
	type ActionResult,
	decideApproval,
	listApprovals,
	mergeIssues,
	setIssueStatus,
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
} from "../core/issues.ts";
import { createProject, listProjects } from "../core/projects.ts";
import { CreateTokenBody, createToken, listTokens, revokeToken } from "../core/tokens.ts";
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
		const projects = await listProjects(c.env.ports.db);
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

	app.post("/v1/issues/:id/release", need("issues:write"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const result = await releaseClaim(c.env.ports, c.get("actor"), params.output.id);
		if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
		if (result.kind === "not_holder") {
			return c.json(
				{ error: "forbidden", reason: "Only the holder of the claim or an admin can release it." },
				403,
			);
		}
		return c.json({
			data: await getIssue(c.env.ports.db, params.output.id, c.env.ports.clock.now()),
		});
	});

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
