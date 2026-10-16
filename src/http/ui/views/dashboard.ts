import type {
	ActivityItem,
	AppHealth,
	AttentionItem,
	AttentionKind,
	Dashboard,
	Visit,
} from "../../../core/dashboard.ts";
import type { IngestStatus } from "../../../core/ingest-status.ts";
import type { IssueRow } from "../../../core/issues.ts";
import type { Series, SeriesRange } from "../../../core/series.ts";
import { ago, count, type Html, h, time } from "../html.ts";
import { appPath, issuePath } from "../ids.ts";
import { pageHead } from "../layout.ts";
import type { ProgressJson } from "../onboarding.ts";
import { displayText as t } from "../text.ts";
import { chartCard, sparkline } from "./chart.ts";

/**
 * The dashboard, for the people who supervise: what changed since the last visit, the events
 * chart, the recent issues of all apps, what needs a person, the fix loop, agent activity and
 * the apps. Agents do the triage; this page shows when they cannot, and whether their fixes
 * work. It works without script; the Live chart updates with script.
 */

export interface DashboardPage {
	data: Dashboard;
	visit: Visit;
	progress: ProgressJson;
	ingest: IngestStatus;
	now: Date;
	series: Series;
	/** The most recent issues of all apps (at most RECENT_ISSUES), of `issues` when it is set. */
	recent: IssueRow[];
	issues: RecentFilter | null;
}

/** The status filters of "Recent issues" (`/?issues=<status>`). */
export const RECENT_FILTERS = [
	["unresolved", "Unresolved"],
	["regressed", "Regressed"],
	["fix_pending", "Fix pending"],
	["verified", "Verified"],
] as const;
export type RecentFilter = (typeof RECENT_FILTERS)[number][0];
export const RECENT_ISSUES = 10;

/** A dashboard URL with its query values (the chart range and the issue filter). */
function dashHref(range: SeriesRange | null, issues: RecentFilter | null, anchor = ""): string {
	const query = new URLSearchParams();
	if (range && range !== "24h") query.set("range", range);
	if (issues) query.set("issues", issues);
	const text = query.toString();
	return `/${text ? `?${text}` : ""}${anchor}`;
}
const issuesHref = (status: RecentFilter) => dashHref(null, status, "#recent");

const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

const issueLink = (item: { issue: AttentionItem["issue"] }) =>
	item.issue
		? h`<a class="attn-title" href="${issuePath(item.issue.id)}">${t(item.issue.title, 200)}</a>`
		: "";

// --- since your last visit ---------------------------------------------------------------

function summary(d: Dashboard): Html {
	const { new_issues, verified, regressed, agent_actions } = d.summary;
	const stat = (n: number, label: string, href: string | null, tone = "") =>
		h`<li class="stat${tone ? ` stat-${tone}` : ""}">${
			href
				? h`<a href="${href}"><span class="stat-n">${count(n)}</span><span class="stat-label">${label}</span></a>`
				: h`<div><span class="stat-n">${count(n)}</span><span class="stat-label">${label}</span></div>`
		}</li>`;
	return h`<ul class="stats" aria-label="Since your last visit">
${stat(new_issues, new_issues === 1 ? "new issue" : "new issues", issuesHref("unresolved"))}
${stat(verified, verified === 1 ? "fix verified" : "fixes verified", issuesHref("verified"), verified > 0 ? "good" : "")}
${stat(regressed, regressed === 1 ? "fix regressed" : "fixes regressed", issuesHref("regressed"), regressed > 0 ? "bad" : "")}
${stat(agent_actions, agent_actions === 1 ? "agent action" : "agent actions", null)}
</ul>`;
}

// --- needs you ---------------------------------------------------------------------------

const KIND_LABEL: Record<AttentionKind, string> = {
	approval: "Approval",
	regressed: "Regressed",
	still_failing: "Fix not working",
	not_deployed: "Fix not deployed",
	expired_claim: "Agent stopped",
	unclaimed: "No agent",
	quota: "Quota reached",
};
const KIND_TONE: Record<AttentionKind, string> = {
	approval: "violet",
	regressed: "bad",
	still_failing: "bad",
	not_deployed: "warn",
	expired_claim: "warn",
	unclaimed: "warn",
	quota: "bad",
};
/** Where "N more" goes, for kinds that the issue filters can show. */
const KIND_MORE: Partial<Record<AttentionKind, string>> = {
	regressed: issuesHref("regressed"),
	still_failing: issuesHref("fix_pending"),
	not_deployed: issuesHref("fix_pending"),
	unclaimed: issuesHref("unresolved"),
	expired_claim: issuesHref("unresolved"),
};

function why(item: AttentionItem, now: Date): Html {
	const app = item.issue ? t(item.issue.project_name, 60) : "";
	switch (item.kind) {
		case "approval":
			return h`${t(item.actor, 60)} asks to ${t(item.detail, 40)} this issue (${ago(item.at, now)}). Approvals are in the API for now: <code>GET /v1/approvals</code>.`;
		case "regressed":
			return h`${app}: the error came back ${item.detail ? h`in <span class="mono">${t(item.detail, 60)}</span> ` : ""}after the fix was deployed (${ago(item.at, now)}).`;
		case "still_failing":
			return h`${app}: the fix is deployed, but the error came again ${ago(item.at, now)}.`;
		case "not_deployed":
			return item.app_has_deploys
				? h`${app}: a fix was linked ${ago(item.at, now)}, and no deploy contains it yet.`
				: h`${app}: a fix was linked ${ago(item.at, now)}, but this app reports no deploys. Checkend cannot verify the fix.`;
		case "expired_claim":
			return h`${app}: the claim of ${t(item.actor, 60)} expired ${ago(item.at, now)}. No agent works on it now.`;
		case "unclaimed":
			return h`${app}: seen ${plural(Number(item.detail ?? 0), "time")}, last ${ago(item.at, now)}. No agent claimed it.`;
		case "quota":
			return h`Ingest drops new events of this app until 00:00 UTC (daily quota: ${count(item.detail)} events).`;
	}
}

const attentionRow = (
	kind: AttentionKind,
	title: Html | string,
	body: Html,
	tone = KIND_TONE[kind],
) =>
	h`<li class="attn"><span class="tag tag-${tone}">${KIND_LABEL[kind]}</span><div class="attn-body">${title}<p>${body}</p></div></li>`;

/** Setup gaps that break the loop: no deploys (no verification), no agent, steps missing. */
function setupRows(progress: ProgressJson): Html[] {
	return progress.apps
		.filter((a) => !a.complete)
		.map((a) => {
			const missing = a.steps.filter((s) => !s.done).map((s) => s.key);
			const title = h`<a class="attn-title" href="${appPath(a.id)}">${a.name}</a>`;
			const body =
				missing.length === 1 && missing[0] === "deploys"
					? h`This app reports no deploys, so Checkend cannot verify fixes. Ask your agent to add the deploy step to CI.`
					: missing.length === 1 && missing[0] === "agent"
						? h`No agent is connected to this app, so nobody claims its issues.`
						: h`Setup is ${a.done} of 5 steps. Next: ${a.steps.find((s) => !s.done)?.label ?? ""}.`;
			return h`<li class="attn"><span class="tag tag-violet">Setup</span><div class="attn-body">${title}<p>${body}</p></div></li>`;
		});
}

function needsYou(page: DashboardPage): Html {
	const { data, progress, ingest, now } = page;
	const rows: Html[] = [];
	if (ingest.mode === "counters_only") {
		rows.push(
			h`<li class="attn"><span class="tag tag-bad">Ingest</span><div class="attn-body"><span class="attn-title">Only counters are stored until 00:00 UTC</span><p>The install is near its daily D1 row limit (${count(ingest.rows_written_today)} of ${count(ingest.daily_row_limit)} rows). New events are counted, not stored.</p></div></li>`,
		);
	}
	const kinds = [...new Set(data.attention.map((a) => a.kind))];
	for (const kind of kinds) {
		const items = data.attention.filter((a) => a.kind === kind);
		for (const item of items) {
			const title =
				item.kind === "quota" && item.app
					? h`<a class="attn-title" href="${appPath(item.app.id)}">${t(item.app.name, 60)}</a>`
					: issueLink(item);
			rows.push(attentionRow(kind, title, why(item, now)));
		}
		const more = data.totals[kind] - items.length;
		const href = KIND_MORE[kind];
		if (more > 0) {
			rows.push(
				h`<li class="attn-more">${href ? h`<a href="${href}">${plural(more, "more issue")}: ${KIND_LABEL[kind].toLowerCase()}</a>` : `${plural(more, "more issue")}`}</li>`,
			);
		}
	}
	rows.push(...setupRows(progress));
	return h`<section class="card dash-attn" aria-labelledby="attn-title">
<h2 id="attn-title">Needs you</h2>
${
	rows.length === 0
		? h`<p class="calm">Nothing needs you. ${
				data.loop.open + data.loop.claimed > 0
					? "The agents work on the open issues."
					: "No open issues."
			}</p>`
		: h`<ul class="attn-list">${rows}</ul>`
}
</section>`;
}

// --- the fix loop ------------------------------------------------------------------------

function fixLoop(d: Dashboard): Html {
	const stage = (n: number, label: string, href: string, tone = "") =>
		h`<li class="stage${tone && n > 0 ? ` stage-${tone}` : ""}"><a href="${href}"><span class="stage-n">${count(n)}</span><span class="stage-label">${label}</span></a></li>`;
	const o = d.outcomes;
	return h`<section class="card" aria-labelledby="loop-title">
<h2 id="loop-title">Fix loop</h2>
<ol class="loop">
${stage(d.loop.open, "Open, no agent", issuesHref("unresolved"), "warn")}
${stage(d.loop.claimed, "Claimed by an agent", issuesHref("unresolved"))}
${stage(d.loop.fix_linked, "Fix linked", issuesHref("fix_pending"))}
${stage(d.loop.fix_deployed, "Deployed, quiet period", issuesHref("fix_pending"))}
${stage(d.loop.verified_7d, "Verified (7 days)", issuesHref("verified"), "good")}
</ol>
<p class="loop-foot">${
		d.loop.regressed > 0
			? h`<a class="regressed-link" href="${issuesHref("regressed")}">${plural(d.loop.regressed, "issue")} regressed</a> · `
			: ""
	}Last 7 days: ${plural(o.verified, "fix", "fixes")} verified, ${count(o.regressed)} regressed${
		o.median_hours_to_verified === null
			? "."
			: h`. Median time from the fix to verified: ${hours(o.median_hours_to_verified)}.`
	}</p>
</section>`;
}

const hours = (h: number) => (h < 48 ? `${h} h` : `${Math.round((h / 24) * 10) / 10} d`);

// --- agent activity ----------------------------------------------------------------------

const VERBS: Record<string, string> = {
	"issue.claim": "claimed",
	"issue.release": "released the claim on",
	"issue.fix": "linked a fix to",
	"issue.fix_deployed": "deployed the fix for",
	"issue.verify": "verified the fix for",
	"issue.regress": "saw a regression of",
	"issue.note": "added a note to",
	"issue.resolve": "resolved",
	"issue.ignore": "ignored",
	"issue.unresolve": "opened again",
	"issue.merge": "merged",
	"issue.split": "split",
	"issue.split_from": "split",
	"issue.triage_correct": "corrected the triage of",
	"approval.request": "asked for an approval on",
	"release.deploy": "reported a deploy of",
	"project.create": "added the app",
	"project.update": "changed the settings of",
	"project.key_create": "made a new DSN key for",
	"project.key_revoke": "revoked a DSN key of",
	"setup.test_event": "sent a test error from",
	"setup.report": "reported a setup step of",
	"token.create": "made a token",
	"token.revoke": "revoked a token",
	"webhook.create": "added a webhook",
	"webhook.delete": "deleted a webhook",
};

function actor(a: ActivityItem): Html {
	if (a.actor_type === "system") return h`<span class="who">Checkend</span>`;
	const agent = a.actor_type === "token" || a.actor_type === "setup_key";
	return h`<span class="who">${t(a.actor_name, 40)}</span>${agent ? h` <span class="muted">(agent)</span>` : ""}`;
}

function activityRow(a: ActivityItem, now: Date): Html {
	const verb = VERBS[a.action];
	const target = a.issue
		? h`<a href="${issuePath(a.issue.id)}">${t(a.issue.title, 90)}</a>`
		: a.app
			? h`<a href="${appPath(a.app.id)}">${t(a.app.name, 60)}</a>`
			: "";
	const release =
		a.action === "release.deploy" && typeof a.data?.release === "string"
			? h` <span class="mono">${t(a.data.release, 20)}</span>`
			: "";
	return h`<li><span class="act-text">${actor(a)} ${verb ?? h`<code>${t(a.action, 40)}</code>`} ${target}${release}</span>${time(a.at, now)}</li>`;
}

function activity(d: Dashboard, now: Date): Html {
	return h`<section class="card" aria-labelledby="activity-title">
<h2 id="activity-title">Activity</h2>
${
	d.activity.length === 0
		? h`<p class="muted">No activity yet. Agents claim issues, link fixes and report deploys here.</p>`
		: h`<ul class="activity">${d.activity.map((a) => activityRow(a, now))}</ul>`
}
</section>`;
}

// --- apps --------------------------------------------------------------------------------

function appRow(a: AppHealth, setup: ProgressJson["apps"][number] | undefined, now: Date): Html {
	return h`<tr>
<td><a href="${appPath(a.id)}">${t(a.name, 60)}</a>${setup && !setup.complete ? h` <span class="pill pill-progress">Setup ${setup.done}/5</span>` : ""}</td>
<td class="spark-cell" data-label="24 h">${sparkline(a.hourly)}<span class="num">${count(a.events_24h)}</span></td>
<td class="num" data-label="Open"><a href="${appPath(a.id)}?status=unresolved">${count(a.open_issues)}</a></td>
<td class="when" data-label="Last deploy">${a.last_deploy_at ? time(a.last_deploy_at, now) : h`<span class="muted">none</span>`}</td>
</tr>`;
}

function apps(d: Dashboard, progress: ProgressJson, now: Date): Html {
	const setupOf = new Map(progress.apps.map((a) => [a.id, a]));
	return h`<section class="card" aria-labelledby="apps-title">
<h2 id="apps-title"><a href="/apps">Apps</a></h2>
<table class="dash-apps">
<caption class="sr">Apps: events in the last 24 hours, open issues and the last deploy</caption>
<thead><tr><th scope="col">App</th><th scope="col">Events, 24 h</th><th scope="col" class="num">Open</th><th scope="col">Last deploy</th></tr></thead>
<tbody>${d.apps.map((a) => appRow(a, setupOf.get(a.id), now))}</tbody>
</table>
</section>`;
}

// --- the page ----------------------------------------------------------------------------

// --- recent issues -----------------------------------------------------------------------

const statusPill = (status: unknown) =>
	h`<span class="pill pill-${String(status)}">${t(status)}</span>`;

function recentRow(issue: IssueRow, now: Date): Html {
	return h`<li class="recent">
<a class="recent-title" href="${issuePath(issue.id)}">${t(issue.title, 200)}</a>
<div class="recent-sub">${statusPill(issue.status)}<a class="recent-app" href="${appPath(issue.project_id)}">${t(issue.project_name, 60)}</a><span class="muted">${plural(Number(issue.times_seen ?? 0), "event")}</span>${time(issue.last_seen as string, now)}</div>
</li>`;
}

function recentIssues(page: DashboardPage): Html {
	const { recent, issues, now, series } = page;
	const tab = (value: RecentFilter | null, label: string) =>
		h`<a href="${dashHref(series.range, value, "#recent")}"${value === issues ? h` aria-current="true"` : ""}>${label}</a>`;
	return h`<section class="card" id="recent" aria-labelledby="recent-title">
<div class="card-head"><h2 id="recent-title">Recent issues</h2>
<nav class="segmented segmented-small" aria-label="Issue status">${tab(null, "All")}${RECENT_FILTERS.map(([value, label]) => tab(value, label))}</nav></div>
${
	recent.length === 0
		? h`<p class="muted">${issues ? "No issues with this status." : "No errors yet."}</p>`
		: h`<ul class="recent-list">${recent.map((issue) => recentRow(issue, now))}</ul>`
}
<p class="card-foot muted">The issues of one app, with search and filters, are on its page in <a href="/apps">Apps</a>.</p>
</section>`;
}

// --- the page ----------------------------------------------------------------------------

export function dashboardView(page: DashboardPage): Html {
	const { data, visit, progress, now, series, issues } = page;
	const sub = visit.previous
		? h`Since your last visit, ${ago(visit.previous, now)}.`
		: "In the last 24 hours.";
	return h`${pageHead("Dashboard", sub)}
<div class="dash">
${summary(data)}
${chartCard(series, (range) => dashHref(range, issues), null)}
<div class="dash-cols">
${recentIssues(page)}
${needsYou(page)}
</div>
${fixLoop(data)}
<div class="dash-cols">
${activity(data, now)}
${apps(data, progress, now)}
</div>
</div>`;
}
