import * as v from "valibot";
import { CLAIM_MAX_MINUTES, NOTE_MAX_CHARS } from "./claims.ts";
import {
	DeployBody,
	FixOutcomeQuery,
	LinkFixBody,
	ReleaseListQuery,
	ReleaseQuery,
} from "./fixes.ts";
import { NativeEvent } from "./ingest/native.ts";
import { MAX_MERGE_SOURCES, MAX_SPLIT_EVENTS } from "./issue-actions.ts";
import { CreateProjectBody, EventListQuery, IssueListQuery } from "./issues.ts";
import { LabelQuery } from "./labels.ts";
import { UpdateProjectBody } from "./projects.ts";
import { AgentTokenBody, RegisterAppBody, ReportBody } from "./setup.ts";
import { SourceMapListQuery, SourceMapUploadQuery } from "./sourcemaps.ts";
import { CreateTokenBody, type Scope } from "./tokens.ts";
import { CreateWebhookBody } from "./webhooks.ts";

export const ClaimBody = v.object({
	minutes: v.optional(
		v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(CLAIM_MAX_MINUTES)),
	),
});

export const NoteBody = v.object({
	text: v.pipe(v.string(), v.minLength(1), v.maxLength(NOTE_MAX_CHARS)),
});

export const SplitBody = v.object({
	event_ids: v.pipe(
		v.array(v.pipe(v.number(), v.integer(), v.minValue(1))),
		v.minLength(1),
		v.maxLength(MAX_SPLIT_EVENTS),
	),
});

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
	method: "GET" | "POST" | "PATCH" | "DELETE";
	/** Hono path syntax: /v1/issues/:id */
	path: string;
	/** The bearer-token scope; null for routes that use the DSN key (X-Checkend-Key). */
	scope: Scope | null;
	/** Also open to a setup key (cks_...): the onboarding routes. */
	setupKey?: true;
	summary: string;
	query?: v.GenericSchema;
	body?: v.GenericSchema;
}

/**
 * Every /v1 route: the source for the OpenAPI document and llms.txt. A test checks that the
 * app has exactly these routes.
 */
export const IngestQuery = v.object({
	project: v.pipe(
		v.string(),
		v.regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
		v.description("The public project ID or the slug."),
	),
});

export const API_ROUTES: ApiRoute[] = [
	{
		method: "POST",
		path: "/v1/ingest",
		scope: null,
		summary:
			"Send one error as simple JSON (for scripts and languages without a Sentry SDK). Auth: the DSN public key in X-Checkend-Key.",
		query: IngestQuery,
		body: NativeEvent,
	},
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
		method: "PATCH",
		path: "/v1/projects/:project",
		scope: "admin",
		summary:
			"Change project settings: repository (GitHub owner/name, or null). The GitHub webhook and pull request fixes use it.",
		body: UpdateProjectBody,
	},
	{
		method: "DELETE",
		path: "/v1/projects/:project",
		scope: "admin",
		summary:
			"Delete a project: its DSN keys stop at once (events get 401), it is hidden everywhere, and the cron purges its data. 204; 202 when REQUIRE_APPROVAL has delete_project and another actor must complete it.",
	},
	{
		method: "POST",
		path: "/v1/projects/:project/keys",
		scope: "admin",
		summary:
			"Add a DSN key (rotation). Returns public_key and dsn. The old keys keep working until you revoke them.",
	},
	{
		method: "DELETE",
		path: "/v1/projects/:project/keys/:key",
		scope: "admin",
		summary:
			"Revoke a DSN key: events with it get 401 (within 60 seconds on every server). 409 for the only active key.",
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
		method: "POST",
		path: "/v1/issues/:id/claim",
		scope: "issues:write",
		summary:
			"Claim an issue for minutes (default 120, at most 1440). 409 when another actor holds an active claim.",
		body: ClaimBody,
	},
	{
		method: "POST",
		path: "/v1/issues/:id/release",
		scope: "issues:write",
		summary: "Release your claim (or any claim, with admin).",
	},
	{
		method: "DELETE",
		path: "/v1/issues/:id/claim",
		scope: "issues:write",
		summary: "Release your claim (the same as POST /release).",
	},
	{
		method: "POST",
		path: "/v1/issues/:id/notes",
		scope: "issues:write",
		summary: "Add a note to the issue timeline.",
		body: NoteBody,
	},
	{
		method: "GET",
		path: "/v1/issues/:id/activity",
		scope: "issues:read",
		summary: "The timeline of an issue: actions and notes, the most recent first.",
		query: LimitQuery,
	},
	{
		method: "POST",
		path: "/v1/issues/:id/split",
		scope: "issues:write",
		summary:
			"Move stored events of this issue to a new issue (the opposite of a merge). Returns the new issue.",
		body: SplitBody,
	},
	{
		method: "POST",
		path: "/v1/issues/:id/fix",
		scope: "issues:write",
		summary:
			"Link a fix: a commit SHA or a GitHub pull request URL. The status becomes fix_pending; a deploy that contains the fix and a quiet period make it verified.",
		body: LinkFixBody,
	},
	{
		method: "POST",
		path: "/v1/deploys",
		scope: "releases:write",
		summary:
			"Report a deploy of a release (created on first use; the default version is the commit SHA). List the commits since the last deploy, so that Checkend knows which fixes it contains.",
		body: DeployBody,
	},
	{
		method: "GET",
		path: "/v1/releases",
		scope: "issues:read",
		summary: "Releases, the most recently deployed first, with their deploys.",
		query: ReleaseListQuery,
	},
	{
		method: "GET",
		path: "/v1/releases/:version",
		scope: "issues:read",
		summary:
			"One release: its deploys, the issues first seen in it, the fixes it deployed, and the issues that regressed in it.",
		query: ReleaseQuery,
	},
	{
		method: "GET",
		path: "/v1/fix-outcomes",
		scope: "admin",
		summary:
			"Fix outcomes (verified or regressed), with the time to verify and who linked the fix, the most recent first.",
		query: FixOutcomeQuery,
	},
	{
		method: "POST",
		path: "/v1/sourcemaps",
		scope: "releases:write",
		summary:
			"Upload the source map of one minified file of a release. The body is the source map JSON (application/json) or a prebuilt index (application/x-checkend-sourcemap-index); at most 30 MB. A new upload for the same release and file path replaces the old one. Needs blob storage (the BLOBS binding).",
		query: SourceMapUploadQuery,
	},
	{
		method: "GET",
		path: "/v1/sourcemaps",
		scope: "issues:read",
		summary: "The source maps of a project, the latest first (optionally of one release).",
		query: SourceMapListQuery,
	},
	{
		method: "DELETE",
		path: "/v1/sourcemaps/:id",
		scope: "releases:write",
		summary: "Delete a source map.",
	},
	{
		method: "GET",
		path: "/v1/alerts",
		scope: "issues:read",
		summary:
			"Alert rules (webhooks and channels): format, events, min_trust, project, spike_threshold. No secrets, no email addresses, URLs without their query string. Admins change them with /v1/webhooks.",
	},
	{
		method: "GET",
		path: "/v1/webhooks",
		scope: "admin",
		summary: "Outgoing webhooks (without their secrets).",
	},
	{
		method: "POST",
		path: "/v1/webhooks",
		scope: "admin",
		summary:
			"Create an alert rule: a webhook (checkend, github_dispatch) or a channel (slack, discord, github_issue, email) for issue.new, issue.regressed, issue.verified and issue.spike (with spike_threshold). URLs must be https with a public address; Slack and Discord URLs are stored encrypted. Returns the signing secret once. Needs ENCRYPTION_KEYS.",
		body: CreateWebhookBody,
	},
	{
		method: "DELETE",
		path: "/v1/webhooks/:id",
		scope: "admin",
		summary: "Delete a webhook. Its pending deliveries fail.",
	},
	{
		method: "POST",
		path: "/v1/webhooks/:id/test",
		scope: "admin",
		summary: "Send a test delivery (event ping).",
	},
	{
		method: "GET",
		path: "/v1/webhooks/:id/deliveries",
		scope: "admin",
		summary: "The latest deliveries of a webhook, with their status and attempts.",
		query: LimitQuery,
	},
	{
		method: "GET",
		path: "/v1/labels",
		scope: "admin",
		summary:
			"Triage history: decisions on issues and their corrections (from the activity), the most recent first.",
		query: LabelQuery,
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
		method: "POST",
		path: "/v1/setup/keys",
		scope: "admin",
		summary:
			"Create a setup key (cks_...) for an agent that connects apps. Valid 1 hour. The key is in this response only.",
	},
	{
		method: "GET",
		path: "/v1/setup/keys",
		scope: "admin",
		summary: "List setup keys (never the keys themselves), the newest first.",
	},
	{ method: "DELETE", path: "/v1/setup/keys/:id", scope: "admin", summary: "Revoke a setup key." },
	{
		method: "POST",
		path: "/v1/setup/apps",
		scope: "admin",
		setupKey: true,
		summary:
			"Register an app (a project) and get its DSN. 201 when new; 200 when this setup key already registered an app with this name. A setup key registers at most 10 apps.",
		body: RegisterAppBody,
	},
	{
		method: "POST",
		path: "/v1/setup/tokens",
		scope: "admin",
		setupKey: true,
		summary:
			"Create an agent token (issues:read, issues:write) for an app. The token is in this response only. A setup key makes at most 5.",
		body: AgentTokenBody,
	},
	{
		method: "POST",
		path: "/v1/setup/apps/:project/test-event",
		scope: "admin",
		setupKey: true,
		summary:
			"Send the one test event of an app (tag checkend.test=true). 409 when it was already sent.",
	},
	{
		method: "POST",
		path: "/v1/setup/apps/:project/report",
		scope: "admin",
		setupKey: true,
		summary: "Report a setup step that only the agent knows: sdk_installed.",
		body: ReportBody,
	},
	{
		method: "GET",
		path: "/v1/setup/progress",
		scope: "admin",
		setupKey: true,
		summary:
			"The setup progress of each app (a setup key: its own apps): connected, SDK installed, test event, first event, first agent MCP call, first deploy.",
	},
	{
		method: "GET",
		path: "/v1/activity",
		scope: "admin",
		summary: "The audit timeline: every write by every actor, the most recent first.",
		query: LimitQuery,
	},
];
