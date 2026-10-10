import * as v from "valibot";
import { CreateProjectBody, EventListQuery, IssueListQuery } from "./issues.ts";
import { CreateTokenBody, type Scope } from "./tokens.ts";

/** A limit query parameter, 1 to 100, default 25. */
export const LimitQuery = v.object({
	limit: v.optional(
		v.pipe(v.string(), v.regex(/^\d{1,3}$/), v.transform(Number), v.minValue(1), v.maxValue(100)),
		"25",
	),
});

export interface ApiRoute {
	method: "GET" | "POST" | "DELETE";
	/** Hono path syntax: /v1/issues/:id */
	path: string;
	scope: Scope;
	summary: string;
	query?: v.GenericSchema;
	body?: v.GenericSchema;
}

/**
 * Every /v1 route: the source for the OpenAPI document and llms.txt. A test checks that the
 * app has exactly these routes.
 */
export const API_ROUTES: ApiRoute[] = [
	{
		method: "GET",
		path: "/v1/projects",
		scope: "issues:read",
		summary: "List projects with their DSNs.",
	},
	{
		method: "POST",
		path: "/v1/projects",
		scope: "admin",
		summary: "Create a project. Returns its DSN.",
		body: CreateProjectBody,
	},
	{
		method: "GET",
		path: "/v1/issues",
		scope: "issues:read",
		summary:
			"List issues, the most recently seen first. Filter by project (public ID or slug) and status.",
		query: IssueListQuery,
	},
	{
		method: "GET",
		path: "/v1/issues/:id",
		scope: "issues:read",
		summary: "One issue, with latest_event_id.",
	},
	{
		method: "GET",
		path: "/v1/issues/:id/events",
		scope: "issues:read",
		summary: "The stored events of an issue, the most recent first.",
		query: EventListQuery,
	},
	{
		method: "GET",
		path: "/v1/events/:id",
		scope: "issues:read",
		summary: "One event, normalized, with secrets removed.",
	},
	{
		method: "GET",
		path: "/v1/tokens",
		scope: "admin",
		summary: "List API tokens (never the tokens themselves).",
	},
	{
		method: "POST",
		path: "/v1/tokens",
		scope: "admin",
		summary: "Create a scoped token. The token is in this response only.",
		body: CreateTokenBody,
	},
	{ method: "DELETE", path: "/v1/tokens/:id", scope: "admin", summary: "Revoke a token." },
	{
		method: "GET",
		path: "/v1/activity",
		scope: "admin",
		summary: "The audit timeline: every write by every actor, the most recent first.",
		query: LimitQuery,
	},
];
