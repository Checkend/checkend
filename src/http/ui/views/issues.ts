import type { InboxFacets, InboxPage, InboxQuery, TagCount } from "../../../core/inbox.ts";
import type { NormalizedEvent } from "../../../core/ingest/normalize.ts";
import { ISSUE_STATUSES, type IssueRow } from "../../../core/issues.ts";
import { count, type Html, h, time } from "../html.ts";
import { eventPath, issuePath } from "../ids.ts";
import { pageHead, untrusted } from "../layout.ts";
import { displayText as t } from "../text.ts";
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

/** The inbox: filters (a GET form, works without JavaScript), then the issue list. */
export function inboxView(
	query: InboxQuery,
	facets: InboxFacets,
	result: InboxPage | "project_not_found",
	now: Date,
): Html {
	const page = result === "project_not_found" ? { data: [], next_cursor: null } : result;
	const filtered = Boolean(
		query.project || query.status || query.environment || query.release || query.since || query.q,
	);
	const next = new URLSearchParams();
	for (const key of ["project", "status", "environment", "release", "since", "q"] as const) {
		const value = query[key];
		if (value) next.set(key, value);
	}
	if (page.next_cursor) next.set("cursor", page.next_cursor);

	return h`${pageHead("Issues", "Errors from your apps, grouped. The most recent first.")}
<form class="filters" method="get" action="/issues" role="search" aria-label="Filter issues">
  <div class="search"><label for="f-q">Search</label><input id="f-q" type="search" name="q" value="${query.q ?? ""}" placeholder="Error type, message or function" maxlength="200"></div>
  ${select(
		"project",
		"Project",
		facets.projects.map((p) => ({ value: String(p.id), label: p.name })),
		query.project,
		"All projects",
	)}
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
  <div class="actions"><button class="btn" type="submit">Filter</button>${filtered ? h`<a href="/issues">Clear</a>` : ""}</div>
</form>
${
	page.data.length === 0
		? h`<div class="empty">${
				result === "project_not_found"
					? h`<h2>No project ${t(query.project, 60)}</h2><p><a href="/projects">Show the projects</a></p>`
					: filtered
						? h`<h2>No issues match these filters</h2><p><a href="/issues">Show all issues</a></p>`
						: h`<h2>No issues yet</h2><p>Connect an app: create a project, then add its DSN to your Sentry SDK.</p><p><a class="btn" href="/projects">Go to projects</a></p>`
			}</div>`
		: h`<table class="issues">
<caption class="sr">Issues, most recently seen first</caption>
<thead><tr><th scope="col">Issue</th><th scope="col" class="num">Events</th><th scope="col">Last seen</th><th scope="col">First seen</th></tr></thead>
<tbody>${page.data.map((issue) => issueRow(issue, now))}</tbody>
</table>
${page.next_cursor ? h`<nav class="pager" aria-label="Pages"><a class="btn btn-quiet" href="/issues?${next.toString()}">Older issues</a></nav>` : ""}`
}`;
}

function issueRow(issue: IssueRow, now: Date): Html {
	return h`<tr>
<td class="issue"><a class="issue-title" href="${issuePath(issue.id)}">${t(issue.title, 300)}</a>
<div class="issue-sub">${statusPill(issue.status)}<span class="level level-${String(issue.level)}">${t(issue.level)}</span><span>${t(issue.project_name, 100)}</span>${issue.culprit ? h`<span class="mono">${t(issue.culprit, 200)}</span>` : ""}${issue.last_release ? h`<span class="mono">${t(issue.last_release, 100)}</span>` : ""}</div></td>
<td class="num" data-label="Events">${count(issue.times_seen)}</td>
<td class="when" data-label="Last seen">${time(issue.last_seen as string, now)}</td>
<td class="when" data-label="First seen">${time(issue.first_seen as string, now)}</td>
</tr>`;
}

export interface IssueDetail {
	issue: IssueRow;
	project: { id: number; name: string } | null;
	event: (Record<string, unknown> & { event: NormalizedEvent }) | null;
	events: IssueRow[];
	tags: TagCount[];
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
	const { issue, project, event, events, tags } = detail;
	const e = event?.event;
	const facts: [string, Html | string][] = [
		["Events", count(issue.times_seen)],
		["Stored events", count(issue.stored_events)],
		["First seen", time(issue.first_seen as string, now)],
		["Last seen", time(issue.last_seen as string, now)],
		["First release", t(issue.first_release ?? "—", 100)],
		["Last release", t(issue.last_release ?? "—", 100)],
	];
	return h`${pageHead(
		t(issue.title, 500),
		h`${statusPill(issue.status)} <span class="level level-${String(issue.level)}">${t(issue.level)}</span> ${issue.culprit ? h`<span class="mono">${t(issue.culprit, 300)}</span>` : ""}`,
		h`<a href="/issues">Issues</a>${project ? h` / <a href="/issues?project=${project.id}">${t(project.name, 100)}</a>` : ""}`,
	)}
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
