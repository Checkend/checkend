import * as v from "valibot";
import { MAX_MERGE_SOURCES } from "./issue-actions.ts";
import { CreateProjectBody, EventListQuery, IssueListQuery } from "./issues.ts";
import { CreateTokenBody, type Scope } from "./tokens.ts";

export const MergeBody = v.object({
	source_ids: v.pipe(
		v.array(v.pipe(v.number(), v.integer(), v.minValue(1))),
		v.minLength(1),
		v.maxLength(MAX_MERGE_SOURCES),
	),
});

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
		method: "POST",
		path: "/v1/issues/:id/resolve",
		scope: "issues:write",
		summary: "Set the status to resolved.",
	},
	{
		method: "POST",
		path: "/v1/issues/:id/ignore",
		scope: "issues:write",
		summary: "Set the status to ignored. Can need an approval (REQUIRE_APPROVAL): then 202.",
	},
	{
		method: "POST",
		path: "/v1/issues/:id/unresolve",
		scope: "issues:write",
		summary: "Set the status to unresolved.",
	},
	{
		method: "POST",
		path: "/v1/issues/:id/merge",
		scope: "issues:write",
		summary: "Merge issues into this issue. Can need an approval (REQUIRE_APPROVAL): then 202.",
		body: MergeBody,
	},
	{
		method: "GET",
		path: "/v1/approvals",
		scope: "admin",
		summary: "Approval requests, the most recent first.",
		query: LimitQuery,
	},
	{
		method: "POST",
		path: "/v1/approvals/:id/approve",
		scope: "admin",
		summary: "Approve a request: the action runs.",
	},
	{
		method: "POST",
		path: "/v1/approvals/:id/reject",
		scope: "admin",
		summary: "Reject a request.",
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
