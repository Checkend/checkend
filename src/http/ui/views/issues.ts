import { CLAIM_DEFAULT_MINUTES } from "../../../core/claims.ts";
import type { InboxFacets, InboxPage, InboxQuery, TagCount } from "../../../core/inbox.ts";
import type { NormalizedEvent } from "../../../core/ingest/normalize.ts";
import { type Claim, ISSUE_STATUSES, type IssueRow } from "../../../core/issues.ts";
import { curl } from "../../../core/recipes.ts";
import { count, type Html, h, time, until } from "../html.ts";
import { appPath, eventPath, issuePath, issueRef } from "../ids.ts";
import { pageHead, untrusted } from "../layout.ts";
import { displayText as t } from "../text.ts";
import { type TrustView, trustLabel } from "../trust.ts";
import { exceptions, keyValues, requestBlock } from "./event-parts.ts";

const statusPill = (status: unknown) =>
	h`<span class="pill pill-${String(status)}">${t(status)}</span>`;

function select(
	name: string,
	label: string,
	values: { value: string; label: string }[],
	current: string | undefined,
	all: string,
): Html {
	return h`<div><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">
<option value="">${all}</option>
${values.map(
	(v) =>
		h`<option value="${v.value}"${v.value === current ? h` selected` : ""}>${t(v.label, 120)}</option>`,
)}
</select></div>`;
}

const plain = (values: string[]) => values.map((value) => ({ value, label: value }));

/** The "last seen" filter: values of the API `since` parameter. */
export const SINCE_CHOICES = [
	["1h", "Last hour"],
	["24h", "Last 24 hours"],
	["7d", "Last 7 days"],
	["30d", "Last 30 days"],
] as const;

/**
 * The issues of one app (its page, `action`): filters (a GET form, works without JavaScript),
 * then the issue list.
 */
export function inboxView(
	query: InboxQuery,
	facets: InboxFacets,
	result: InboxPage | "project_not_found",
	now: Date,
	action: string,
): Html {
	const page = result === "project_not_found" ? { data: [], next_cursor: null } : result;
	const filtered = Boolean(
		query.status || query.environment || query.release || query.since || query.q,
	);
	const next = new URLSearchParams();
	for (const key of ["status", "environment", "release", "since", "q"] as const) {
		const value = query[key];
		if (value) next.set(key, value);
	}
	if (page.next_cursor) next.set("cursor", page.next_cursor);

	return h`<form class="filters" method="get" action="${action}" role="search" aria-label="Filter issues">
  <div class="search"><label for="f-q">Search</label><input id="f-q" type="search" name="q" value="${query.q ?? ""}" placeholder="Error type, message or function" maxlength="200"></div>
  ${select("status", "Status", plain([...ISSUE_STATUSES]), query.status, "Any status")}
  ${select("environment", "Environment", plain(facets.environments), query.environment, "All environments")}
  ${select("release", "Release", plain(facets.releases), query.release, "All releases")}
  ${select(
		"since",
		"Last seen",
		SINCE_CHOICES.map(([value, label]) => ({ value, label })),
		query.since,
		"Any time",
	)}
  <div class="actions"><button class="btn" type="submit">Filter</button>${filtered ? h`<a href="${action}">Clear</a>` : ""}</div>
</form>
${
	page.data.length === 0
		? h`<div class="empty">${
				result === "project_not_found"
					? h`<h2>No app ${t(query.project, 60)}</h2><p><a href="/apps">Show the apps</a></p>`
					: filtered
						? h`<h2>No issues match these filters</h2><p><a href="${action}">Show all issues</a></p>`
						: h`<h2>No errors yet</h2><p>When this app sends an error, it is here. The Setup tab has the steps.</p>`
			}</div>`
		: h`<table class="issues">
<caption class="sr">Issues, most recently seen first</caption>
<thead><tr><th scope="col">Issue</th><th scope="col" class="num">Events</th><th scope="col">Last seen</th><th scope="col">First seen</th></tr></thead>
<tbody>${page.data.map((issue) => issueRow(issue, now))}</tbody>
</table>
${page.next_cursor ? h`<nav class="pager" aria-label="Pages"><a class="btn btn-quiet" href="${action}?${next.toString()}">Older issues</a></nav>` : ""}`
}`;
}

function issueRow(issue: IssueRow, now: Date): Html {
	return h`<tr>
<td class="issue"><a class="issue-title" href="${issuePath(issue.id)}">${t(issue.title, 300)}</a>
<div class="issue-sub">${statusPill(issue.status)}<span class="level level-${String(issue.level)}">${t(issue.level)}</span>${issue.culprit ? h`<span class="mono">${t(issue.culprit, 200)}</span>` : ""}${issue.last_release ? h`<span class="mono">${t(issue.last_release, 100)}</span>` : ""}</div></td>
<td class="num" data-label="Events">${count(issue.times_seen)}</td>
<td class="when" data-label="Last seen">${time(issue.last_seen as string, now)}</td>
<td class="when" data-label="First seen">${time(issue.first_seen as string, now)}</td>
</tr>`;
}

export interface IssueDetail {
	/** From getIssue(): the API shape of an issue. */
	issue: Record<string, unknown>;
	project: { id: number; name: string } | null;
	event: (Record<string, unknown> & { event: NormalizedEvent }) | null;
	events: IssueRow[];
	tags: TagCount[];
	actions: IssueActions;
}

/** What the signed-in member can do on the issue page. */
export interface IssueActions {
	/** The public URL of this install, with its base path: for the prompt and the commands. */
	origin: string;
	csrf: string;
	/** The member holds the active claim. */
	holdsClaim: boolean;
	/** An owner: can release a claim that another actor holds. */
	canReleaseAny: boolean;
	/** The `done` value of the redirect after an action (unknown values show nothing). */
	done: string | undefined;
}

// --- "Fix this" and the actions -------------------------------------------------------

/** Open issues: an agent (or a person) can fix them. */
const OPEN = new Set(["unresolved", "regressed"]);
/** Closed by a person: Unresolve opens them again. fix_pending and verified belong to the fix loop. */
const CLOSED = new Set(["resolved", "ignored"]);

/**
 * The prompt of "Copy prompt for your agent". The issue is named by its ID and URL only: the title
 * is event data, and a prompt must not carry text that an agent could read as an instruction.
 */
export function fixPrompt(origin: string, issueId: number): string {
	const id = issueRef(issueId);
	return `Fix the Checkend issue ${id} (${origin}${issuePath(id)}). Read its brief: run \`ce issue view ${id}\`, or call the MCP tool get_issue_brief with issue_id ${id}. Call claim_issue, so that other agents do not work on the same issue. Find the cause in this repository, fix it, and add a test that reproduces the error. Make a commit or pull request, then call link_fix with the commit SHA or the pull request URL. Checkend verifies the fix after the deploy.`;
}

/** The same steps as commands, for people who use the CLI. The token comes from the environment. */
export function fixCommands(origin: string, issueId: number): string {
	const id = issueRef(issueId);
	const api = `${origin}/v1/issues/${id}`;
	return `ce issue view ${id}

# Claim it (${CLAIM_DEFAULT_MINUTES / 60} hours), so that agents do not work on it:
${curl("POST", `${api}/claim`, "CHECKEND_TOKEN")}

# After the commit: link the fix (or {"pr_url":"<url>"}).
${curl("POST", `${api}/fix`, "CHECKEND_TOKEN", '{"commit":"<sha>"}')}`;
}

/** The notice after an action: fixed texts only, never the query value. */
const NOTICES: Record<string, string> = {
	resolve: "You resolved this issue by hand. A new event opens it again.",
	ignore: "You ignored this issue. New events do not open it again.",
	unresolve: "You opened this issue again.",
	claim: `You claimed this issue for ${CLAIM_DEFAULT_MINUTES / 60} hours.`,
	claim_taken: "Another member or agent claimed this issue first.",
	release: "The claim is released.",
	not_holder: "Only the holder of the claim or an owner can release it.",
	approval:
		"The action waits for an approval, because this install needs approvals for it (REQUIRE_APPROVAL).",
};

function fixBlock(issueId: number, origin: string): Html {
	return h`<section class="fix" aria-labelledby="fix-title">
<div class="fix-head"><div><h2 id="fix-title">Fix this</h2>
<p class="muted">Paste the prompt into your coding agent. It reads the brief, claims the issue, fixes it and links the fix.</p></div>
<button class="btn" type="button" data-copy-text="${fixPrompt(origin, issueId)}">Copy prompt for your agent</button></div>
<details class="fix-cli"><summary>Do it yourself with the CLI</summary>
<pre class="snippet"><code>${fixCommands(origin, issueId)}</code></pre>
<p class="hint">Put an API token with <code>issues:write</code> in <code>CHECKEND_TOKEN</code>.</p>
</details>
</section>`;
}

const actionForm = (issueId: number, action: string, csrf: string, label: string) =>
	h`<form method="post" action="${issuePath(issueId)}/${action}"><input type="hidden" name="_csrf" value="${csrf}"><button class="btn btn-quiet btn-small" type="submit">${label}</button></form>`;

function claimLine(
	issueId: number,
	claim: Claim | null,
	a: IssueActions,
	open: boolean,
	now: Date,
): Html {
	if (!claim) {
		return open
			? h`<div class="claim"><span class="muted">Nobody works on this issue.</span>${actionForm(issueId, "claim", a.csrf, "Claim")}</div>`
			: h``;
	}
	const release = a.holdsClaim
		? actionForm(issueId, "release", a.csrf, "Release")
		: a.canReleaseAny
			? h`<details class="confirm"><summary>Release the claim</summary>
<form method="post" action="${issuePath(issueId)}/release"><input type="hidden" name="_csrf" value="${a.csrf}">
<p>Release the claim of ${t(claim.holder, 100)}? Another agent can then work on this issue.</p>
<button class="btn btn-danger btn-small" type="submit">Release the claim</button>
</form></details>`
			: "";
	return h`<div class="claim"><span>Claimed by ${a.holdsClaim ? "you, " : ""}<strong>${t(claim.holder, 100)}</strong>, expires ${until(claim.expires_at, now)}</span>${release}</div>`;
}

function statusActions(issueId: number, status: string, a: IssueActions): Html {
	if (OPEN.has(status)) {
		return h`<div class="status-actions">${actionForm(issueId, "resolve", a.csrf, "Resolve")}
<details class="confirm"><summary>Ignore</summary>
<form method="post" action="${issuePath(issueId)}/ignore"><input type="hidden" name="_csrf" value="${a.csrf}">
<p>Ignore this issue? New events do not open it again, and it leaves the open issues.</p>
<button class="btn btn-danger btn-small" type="submit">Ignore issue</button>
</form></details></div>
<p class="hint">Resolve closes the issue by hand: it is not a verified fix. Checkend verifies a fix only after a deploy.</p>`;
	}
	if (CLOSED.has(status)) {
		return h`<div class="status-actions">${actionForm(issueId, "unresolve", a.csrf, "Unresolve")}</div>`;
	}
	if (status === "fix_pending") {
		return h`<p class="hint">A fix is linked. Checkend checks it after the deploy that contains it.</p>`;
	}
	return h``;
}

function actionsBlock(issue: Record<string, unknown>, a: IssueActions, now: Date): Html {
	const id = Number(issue.id);
	const status = String(issue.status);
	if (status === "merged") return h``;
	const notice = a.done && Object.hasOwn(NOTICES, a.done) ? NOTICES[a.done] : null;
	return h`${notice ? h`<p class="notice" role="status">${notice}</p>` : ""}
${OPEN.has(status) ? fixBlock(id, a.origin) : ""}
<div class="issue-actions">
${claimLine(id, (issue.claim as Claim | null) ?? null, a, OPEN.has(status), now)}
${statusActions(id, status, a)}
</div>`;
}

function tagsView(tags: TagCount[], stored: number): Html {
	const byKey = new Map<string, TagCount[]>();
	for (const tag of tags) byKey.set(tag.key, [...(byKey.get(tag.key) ?? []), tag]);
	if (byKey.size === 0) return h`<p class="muted">No tags.</p>`;
	return h`<ul class="tags">${[...byKey].map(
		([key, values]) =>
			h`<li><div class="tag-key">${t(key, 200)}</div>${values
				.slice(0, 5)
				.map(
					(v) =>
						h`<div class="tag-row"><span class="v">${t(v.value, 200)}</span><meter min="0" max="${Math.max(stored, v.count)}" value="${v.count}" aria-label="${count(v.count)} of ${count(stored)} stored events"></meter><span class="n">${count(v.count)}</span></div>`,
				)}</li>`,
	)}</ul>`;
}

/** One issue: facts, in-app frames of the latest event, tags, and the recent events. */
export function issueView(detail: IssueDetail, now: Date): Html {
	const { issue, project, event, events, tags, actions } = detail;
	const e = event?.event;
	const facts: [string, Html | string][] = [
		["Events", count(issue.times_seen)],
		["Stored events", count(issue.stored_events)],
		["First seen", time(issue.first_seen as string, now)],
		["Last seen", time(issue.last_seen as string, now)],
		["First release", t(issue.first_release ?? "—", 100)],
		["Last release", t(issue.last_release ?? "—", 100)],
		// The source trust of the app (core/trust.ts): fixed text, never the SDK name.
		["Source", trustLabel(issue as unknown as TrustView, true)],
	];
	return h`${pageHead(
		t(issue.title, 500),
		h`${statusPill(issue.status)} <span class="level level-${String(issue.level)}">${t(issue.level)}</span> ${issue.culprit ? h`<span class="mono">${t(issue.culprit, 300)}</span>` : ""}`,
		h`<a href="/apps">Apps</a>${project ? h` / <a href="${appPath(project.id)}">${t(project.name, 100)}</a>` : ""}`,
	)}
${actionsBlock(issue, actions, now)}
<dl class="facts">${facts.map(
		([k, v]) => h`<div><dt>${k}</dt>
<dd>${v}</dd></div>`,
	)}</dl>
<div class="grid-2">
  <div class="stack">
    ${
			e
				? h`${untrusted(
						"Stack trace",
						e.exceptions.length > 0
							? exceptions(e.exceptions, false)
							: h`<p class="value">${t(e.message ?? "(no message)", 4000)}</p>`,
					)}
${e.request ? untrusted("Request", requestBlock(e.request)) : ""}
<p><a href="${eventPath(event?.id as number)}">Show the full latest event</a> · ${time(e.timestamp, now)}</p>`
				: h`<div class="empty"><p>No stored event. Checkend counts this issue, but stores at most ${count(issue.stored_events)} events per issue, and none in budget mode.</p></div>`
		}
  </div>
  <div class="stack">
    ${untrusted("Tags", tagsView(tags, Number(issue.stored_events)))}
    <div>
      <h2>Recent events</h2>
      ${
				events.length === 0
					? h`<p class="muted">None stored.</p>`
					: h`<ul class="list">${events.map(
							(ev) =>
								h`<li><a href="${eventPath(ev.id)}">${time(ev.timestamp as string, now)}</a><span class="muted mono">${t(ev.environment ?? "", 60)} ${t(ev.release ?? "", 60)}</span></li>`,
						)}</ul>`
			}
    </div>
  </div>
</div>`;
}

/** The release and environment of an event, for small lists. */
export const eventMeta = (e: NormalizedEvent): Html =>
	keyValues(
		[
			["event_id", e.event_id],
			["time", e.timestamp],
			["level", e.level],
			["platform", e.platform],
			["release", e.release],
			["environment", e.environment],
			["server_name", e.server_name],
			["sdk", e.sdk ? `${e.sdk.name ?? ""} ${e.sdk.version ?? ""}` : null],
		].filter(([, v]) => v !== null && v !== undefined) as [unknown, unknown][],
	) as Html;
