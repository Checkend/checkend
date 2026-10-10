import type { Context, Hono } from "hono";
import * as v from "valibot";
import { isAdmin } from "../core/admin-auth.ts";
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
import type { AppEnv } from "./app.ts";

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

/** The JSON API, `/v1`. One admin bearer token for now; scoped tokens come later. */
export function apiRoutes(app: Hono<AppEnv>, state: IngestState): void {
	app.use("/v1/*", async (c, next) => {
		if (!(await isAdmin(c.req.header("authorization") ?? null, c.env.ports.config.adminToken))) {
			c.header("WWW-Authenticate", "Bearer");
			return c.json({ error: "unauthorized" }, 401);
		}
		c.header("Cache-Control", "no-store");
		await next();
	});

	app.get("/v1/projects", async (c) => {
		const origin = new URL(c.req.url).origin;
		const projects = await listProjects(c.env.ports.db);
		return c.json({
			data: projects.map(({ keys, ...p }) => ({
				...p,
				dsns: keys.map((k) => dsn(origin, k, p.id)),
			})),
		});
	});

	app.post("/v1/projects", async (c) => {
		const body = v.safeParse(CreateProjectBody, await c.req.json().catch(() => null));
		if (!body.success) return invalid(c, body.issues);
		const project = await createProject(c.env.ports, body.output);
		const { publicKey, createdAt, ...rest } = project;
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

	app.get("/v1/issues", async (c) => {
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

	app.get("/v1/issues/:id", async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const issue = await getIssue(c.env.ports.db, params.output.id);
		return issue ? c.json({ data: issue }) : c.json({ error: "not_found" }, 404);
	});

	app.get("/v1/issues/:id/events", async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		const query = v.safeParse(EventListQuery, c.req.query());
		if (!params.success) return invalid(c, params.issues);
		if (!query.success) return invalid(c, query.issues);
		return c.json({
			data: await listIssueEvents(c.env.ports.db, params.output.id, query.output.limit),
		});
	});

	app.get("/v1/events/:id", async (c) => {
		const params = v.safeParse(IdParam, c.req.param());
		if (!params.success) return invalid(c, params.issues);
		const event = await getEvent(c.env.ports.db, params.output.id);
		return event ? c.json({ data: event }) : c.json({ error: "not_found" }, 404);
	});
}
