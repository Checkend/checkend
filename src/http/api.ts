import type { Context, Hono } from "hono";
import * as v from "valibot";
import { listActivity } from "../core/activity.ts";
import type { IngestState } from "../core/ingest/state.ts";
import { ingestStatus } from "../core/ingest-status.ts";
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

const LimitQuery = v.object({
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1), v.maxValue(100)),
		"25",
	),
});

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
		const page = await listIssues(c.env.ports.db, query.output, after);
		return c.json({ ...page, ingest: await ingestStatus(c.env.ports, state) });
	});

	app.get("/v1/issues/:id", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const issue = await getIssue(c.env.ports.db, params.output.id);
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

	app.get("/v1/events/:id", need("issues:read"), async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const event = await getEvent(c.env.ports.db, params.output.id);
		return event ? c.json({ data: event }) : c.json({ error: "not_found" }, 404);
	});
}
