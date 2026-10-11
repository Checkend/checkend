import type { ProjectSummary } from "../../../core/projects.ts";
import { type Child, count, type Html, h, time } from "../html.ts";
import { appPath } from "../ids.ts";
import { pageHead } from "../layout.ts";
import {
	AGENT_TASKS,
	type AppProgress,
	KEY_PLACEHOLDER,
	PLATFORM_LABELS,
	type ProgressJson,
	platformLabel,
	setupPrompt,
	stepsFor,
	taskPrompt,
} from "../onboarding.ts";
import { displayText as t } from "../text.ts";
import { lowTrustNote, trustBadge } from "../trust.ts";

export const PLATFORMS = ["node", "javascript", "python", "ruby", "php", "go", "other"] as const;

/**
 * The DSN of a project key: the public key and the public project ID, on this host. `base` is the
 * public URL of the install, with its base path.
 */
export function dsnFor(base: string, key: string, publicId: number): string {
	const url = new URL(base);
	return `${url.protocol}//${key}@${url.host}${url.pathname.replace(/\/$/, "")}/${publicId}`;
}

// --- the prompt box and the live checklist ---------------------------------------------

/** The prompt box. "Copy prompt" makes a new setup key each time (a form, so it also works without JavaScript). */
function promptBox(
	origin: string,
	csrf: string,
	prompt: string | null,
	unavailable: boolean,
): Html {
	return h`<section class="prompt-card" aria-labelledby="prompt-title">
<div class="prompt-head">
<h2 id="prompt-title">Paste this into Claude Code, Codex or Cursor, in your app's repository</h2>
</div>
<pre class="prompt" id="setup-prompt" data-placeholder="${prompt ? "" : "1"}"><code>${prompt ?? setupPrompt(origin, KEY_PLACEHOLDER)}</code></pre>
<form class="prompt-actions" method="post" action="/apps/setup-key" data-setup-prompt>
<input type="hidden" name="_csrf" value="${csrf}">
<button class="btn btn-large" type="submit"${unavailable ? h` disabled` : ""}>Copy prompt</button>
<p class="status-line" id="prompt-status" role="status" aria-live="polite">${
		unavailable
			? "This install cannot make setup keys yet. Update Checkend, or set up the app by hand."
			: prompt
				? "Copy the prompt above. The key in it is valid for 1 hour."
				: ""
	}</p>
</form>
<p class="hint">Each copy makes a new setup key. It is valid for 1 hour. It can add apps, send a test error, and make agent tokens that read and change issues. Treat the prompt as a secret.</p>
</section>`;
}

const STEP_MARK = h`<span class="mark" aria-hidden="true"></span>`;

function stepItems(steps: { key: string; label: string; done: boolean; detail: string }[]): Html {
	return h`${steps.map(
		(s) =>
			h`<li data-step="${s.key}" data-done="${s.done ? "true" : "false"}">${STEP_MARK}<span class="step-label">${s.label}<span class="sr" data-step-state>${s.done ? " (done)" : " (not yet)"}</span></span><span class="step-detail">${s.detail}</span></li>`,
	)}`;
}

function progressApp(app: ProgressJson["apps"][number]): Html {
	return h`<div class="progress-app" data-app="${app.id}">
<div class="progress-app-head"><a data-app-name href="${appPath(app.id)}">${app.name}</a><span class="muted" data-app-count>${app.done} of 5</span></div>
<ol class="steps">${stepItems(app.steps)}</ol>
</div>`;
}

const EMPTY_STEPS = [
	{ key: "connected", label: "App connected", done: false, detail: "" },
	{ key: "sdk", label: "SDK installed", done: false, detail: "" },
	{ key: "test_event", label: "Test error received", done: false, detail: "" },
	{ key: "agent", label: "Agent connected (MCP)", done: false, detail: "" },
	{ key: "deploys", label: "Deploys reported", done: false, detail: "" },
];

/** The live checklist. The client script polls /apps/progress and updates it as text. */
export function checklist(progress: ProgressJson, only?: number): Html {
	const apps = only === undefined ? progress.apps : progress.apps.filter((a) => a.id === only);
	return h`<section class="progress" data-progress${only === undefined ? "" : h` data-progress-only="${only}"`} aria-labelledby="progress-title">
<div class="progress-title-row"><h2 id="progress-title">Live progress</h2><span class="live" data-js-only hidden>Live</span></div>
<p class="progress-waiting muted" data-progress-waiting${apps.length > 0 ? h` hidden` : ""}>${
		progress.waiting
			? "Your agent has a key. Waiting for it to connect the app…"
			: "Waiting for your agent. Copy the prompt, then paste it into your agent."
	}</p>
<div data-progress-apps>${apps.map(progressApp)}</div>
${only === undefined ? h`<p class="progress-done" data-progress-done${progress.all_complete ? "" : h` hidden`}>Every app is set up. <a href="/issues">Go to the errors</a></p>` : ""}
<template data-progress-template>${progressApp({ id: 0, name: "", complete: false, done: 0, steps: EMPTY_STEPS as ProgressJson["apps"][number]["steps"] })}</template>
</section>`;
}

/** The first screen after setup: the prompt box and the live checklist. */
export function homeView(
	origin: string,
	csrf: string,
	progress: ProgressJson,
	prompt: string | null,
	unavailable: boolean,
): Html {
	return h`<div class="onboard">
<div class="hero">
<p class="eyebrow">Connect your app</p>
<h1>Let your coding agent set up error tracking</h1>
<p class="lead">Checkend is built for coding agents. Copy the prompt, paste it into your agent in your app's repository, and watch each step here as it happens.</p>
</div>
${promptBox(origin, csrf, prompt, unavailable)}
${checklist(progress)}
<p class="muted small">No coding agent? <a href="/apps/new#manual">Add an app by hand</a>.</p>
</div>`;
}

export interface NewAppForm {
	name?: string;
	platform?: string;
	error?: string;
}

/** "Add app": the same prompt box, and a form for people without an agent. */
export function newAppView(
	origin: string,
	csrf: string,
	progress: ProgressJson,
	prompt: string | null,
	unavailable: boolean,
	form: NewAppForm = {},
): Html {
	return h`${pageHead("Add an app", "Your coding agent adds the app and sets it up. You see each step below.", h`<a href="/apps">Apps</a>`)}
<div class="onboard">
${promptBox(origin, csrf, prompt, unavailable)}
${checklist(progress)}
<section class="card manual-create" id="manual" aria-labelledby="manual-title">
<h2 id="manual-title">No coding agent? Add the app by hand</h2>
<p class="muted">Checkend makes the app and shows the code to put in it.</p>
<form method="post" action="/apps">
<input type="hidden" name="_csrf" value="${csrf}">
${form.error ? h`<p class="error" role="alert">${form.error}</p>` : ""}
<div class="form-row">
<div class="field"><label for="a-name">App name</label><input id="a-name" type="text" name="name" required maxlength="100" value="${form.name ?? ""}" autocomplete="off"${form.error ? h` aria-invalid="true"` : ""}></div>
<div class="field"><label for="a-platform">Language</label><select id="a-platform" name="platform">${PLATFORMS.map(
		(p) =>
			h`<option value="${p}"${p === (form.platform ?? "node") ? h` selected` : ""}>${PLATFORM_LABELS[p] ?? p}</option>`,
	)}</select></div>
</div>
<button class="btn btn-quiet" type="submit">Add the app</button>
</form>
</section>
</div>`;
}

// --- "Ask your agent" ------------------------------------------------------------------

/** The menu on each app row: each item copies a short prompt that names a recipe. */
function askMenu(origin: string, app: { id: number; slug: string }): Html {
	return h`<details class="menu">
<summary class="btn btn-quiet btn-small">Ask your agent</summary>
<div class="menu-list">
<p class="menu-hint">Copies a prompt for your coding agent.</p>
${AGENT_TASKS.map(
	(task) =>
		h`<button class="menu-item" type="button" data-copy-text="${taskPrompt(origin, app, task)}"><span class="menu-label">${task.label}</span><span class="menu-desc">${task.description}</span></button>`,
)}
</div>
</details>`;
}

/** The same tasks as cards, on the app page. */
function taskCards(origin: string, app: { id: number; slug: string }): Html {
	return h`<ul class="tasks">${AGENT_TASKS.map(
		(task) => h`<li class="task">
<div><h3>${task.label}</h3><p class="muted">${task.description}</p></div>
<button class="btn btn-quiet btn-small" type="button" data-copy-text="${taskPrompt(origin, app, task)}">Copy prompt</button>
</li>`,
	)}</ul>`;
}

// --- the Apps list ---------------------------------------------------------------------

export interface AppRow {
	project: ProjectSummary;
	progress: AppProgress | null;
	demo: boolean;
}

function setupStatus(row: AppRow, now: Date): Html {
	if (row.demo) return h`<span class="pill pill-demo">Demo data</span>`;
	if (!row.progress) return h`<span class="muted">—</span>`;
	const steps = stepsFor(row.progress, now);
	const done = steps.filter((s) => s.done).length;
	return done === steps.length
		? h`<span class="pill pill-resolved">Set up</span>`
		: h`<a class="pill pill-progress" href="${appPath(row.project.id)}">${done} of ${steps.length}</a>`;
}

export function appsView(rows: AppRow[], origin: string, now: Date, notice: string | null): Html {
	return h`<div class="page-head page-head-row">
<div><h1>Apps</h1><p>Each app sends its errors to Checkend. Your coding agent sets them up and changes them.</p></div>
<a class="btn" href="/apps/new">Add app</a>
</div>
${notice ? h`<p class="notice" role="status">${notice}</p>` : ""}
${
	rows.length === 0
		? h`<div class="empty"><h2>No apps yet</h2><p>Add an app: your coding agent does the setup.</p><p><a class="btn" href="/apps/new">Add app</a></p></div>`
		: h`<table class="apps">
<thead><tr><th scope="col">App</th><th scope="col" class="num">Errors, 24 h</th><th scope="col">Last error</th><th scope="col">Source</th><th scope="col">Setup</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
<tbody>${rows.map(
				(row) => h`<tr>
<td class="app"><a class="app-name" href="${appPath(row.project.id)}">${t(row.project.name, 100)}</a><span class="app-sub">${platformLabel(row.project.platform)}</span></td>
<td class="num" data-label="Errors, 24 h:">${count(row.project.events_24h)}</td>
<td class="when" data-label="Last error:">${row.project.last_event_at ? time(row.project.last_event_at, now) : "none yet"}</td>
<td class="source">${trustBadge(row.project, row.project.last_event_at !== null)}</td>
<td class="status">${setupStatus(row, now)}</td>
<td class="actions">${askMenu(origin, row.project)}</td>
</tr>`,
			)}</tbody>
</table>`
}`;
}

// --- one app ---------------------------------------------------------------------------

// The package names are in constants, so that the source has no SDK import (Checkend never
// reports its own errors; test/node/self-reporting.test.ts checks the source).
const NODE_SDK = "@sentry/node";
const BROWSER_SDK = "@sentry/browser";

interface Sdk {
	id: string;
	label: string;
	file: string;
	code: (dsn: string) => string;
}

export const SDKS: Sdk[] = [
	{
		id: "node",
		label: "Node.js",
		file: "instrument.mjs (import it before any other code)",
		code: (dsn) => `npm install ${NODE_SDK}

import * as Sentry from "${NODE_SDK}";

Sentry.init({
  dsn: "${dsn}",
  environment: process.env.NODE_ENV,
  release: process.env.APP_RELEASE,
});`,
	},
	{
		id: "javascript",
		label: "Browser",
		file: "the entry file of your front end",
		code: (dsn) => `npm install ${BROWSER_SDK}

import * as Sentry from "${BROWSER_SDK}";

Sentry.init({
  dsn: "${dsn}",
  environment: "production",
  release: "my-app@1.0.0",
});`,
	},
	{
		id: "python",
		label: "Python",
		file: "the start of your app",
		code: (dsn) => `pip install sentry-sdk

import sentry_sdk

sentry_sdk.init(
    dsn="${dsn}",
    environment="production",
)`,
	},
	{
		id: "ruby",
		label: "Ruby",
		file: "config/initializers/sentry.rb",
		code: (dsn) => `bundle add sentry-ruby

Sentry.init do |config|
  config.dsn = "${dsn}"
  config.environment = "production"
end`,
	},
	{
		id: "php",
		label: "PHP",
		file: "the start of your app",
		code: (dsn) => `composer require sentry/sentry

\\Sentry\\init([
    'dsn' => '${dsn}',
    'environment' => 'production',
]);`,
	},
	{
		id: "go",
		label: "Go",
		file: "main.go",
		code: (dsn) => `go get github.com/getsentry/sentry-go

err := sentry.Init(sentry.ClientOptions{
    Dsn:         "${dsn}",
    Environment: "production",
})`,
	},
];

export type AppTab = "agent" | "manual";

export interface AppPageData {
	project: ProjectSummary;
	progress: ProgressJson;
	demo: boolean;
	tab: AppTab;
	sdk: string | undefined;
	csrf: string;
	deleteError?: string;
	/** False for a member who is not an owner (hosted installs): no delete form. */
	canDelete?: boolean;
}

function tabs(id: number, tab: AppTab): Html {
	const link = (key: AppTab, href: string, label: string) =>
		h`<a href="${href}"${key === tab ? h` aria-current="page"` : ""}>${label}</a>`;
	return h`<nav class="tabs" aria-label="App">${link("agent", appPath(id), "With your agent")}${link("manual", `${appPath(id)}?tab=manual`, "Manual setup")}</nav>`;
}

function manualTab(project: ProjectSummary, origin: string, sdkId: string | undefined): Html {
	const key = project.keys[0];
	if (!key)
		return h`<p class="notice">This app has no active key. Ask your agent to replace the app key.</p>`;
	const dsn = dsnFor(origin, key, project.id);
	const sdk =
		SDKS.find((s) => s.id === sdkId) ?? SDKS.find((s) => s.id === project.platform) ?? SDKS[0];
	if (!sdk) return h``;
	return h`<section class="stack" aria-labelledby="dsn-title">
<div>
<h2 id="dsn-title">App key (<abbr title="Data Source Name: the address where the SDK sends errors. It is not a secret: browser apps include it. It cannot read errors.">DSN</abbr>)</h2>
<div class="dsn"><code id="dsn">${dsn}</code><button class="btn btn-quiet btn-small" type="button" data-copy="dsn" data-js-only hidden>Copy</button></div>
</div>
<div>
<h2>Setup code</h2>
<nav class="segmented" aria-label="Language">${SDKS.map(
		(s) =>
			h`<a href="${appPath(project.id)}?tab=manual&amp;sdk=${s.id}"${s.id === sdk.id ? h` aria-current="true"` : ""}>${s.label}</a>`,
	)}</nav>
<div class="snippet-head"><p class="muted">Put it in ${sdk.file}.</p><button class="btn btn-quiet btn-small" type="button" data-copy="snippet" data-js-only hidden>Copy</button></div>
<pre class="snippet"><code id="snippet">${sdk.code(dsn)}</code></pre>
<p class="hint">Checkend works with the Sentry SDKs: any of them can send errors here.</p>
</div>
</section>`;
}

function dangerZone(data: AppPageData): Html {
	const { project, csrf, demo } = data;
	if (data.canDelete === false) {
		return h`<section class="danger" aria-labelledby="delete-title">
<h2 id="delete-title">Delete app</h2>
<p class="muted">Only an owner of this space can delete an app.</p>
</section>`;
	}
	if (demo) {
		return h`<section class="danger" aria-labelledby="delete-title">
<h2 id="delete-title">Delete the demo</h2>
<p class="muted">This app has demo data from <code>npm run demo</code>. Delete it when you do not need it.</p>
<form method="post" action="${appPath(project.id)}/delete">
<input type="hidden" name="_csrf" value="${csrf}">
<input type="hidden" name="demo" value="1">
<button class="btn btn-danger" type="submit">Delete demo</button>
</form>
</section>`;
	}
	return h`<section class="danger" aria-labelledby="delete-title">
<h2 id="delete-title">Delete app</h2>
<p class="muted">Checkend stops accepting errors from this app at once, then deletes all its errors. You cannot undo this.</p>
<form method="post" action="${appPath(project.id)}/delete">
<input type="hidden" name="_csrf" value="${csrf}">
${data.deleteError ? h`<p class="error" role="alert">${data.deleteError}</p>` : ""}
<div class="field"><label for="confirm">Type <strong>${t(project.name, 100)}</strong> to confirm</label><input id="confirm" type="text" name="confirm" required autocomplete="off" spellcheck="false"${data.deleteError ? h` aria-invalid="true"` : ""}></div>
<button class="btn btn-danger" type="submit">Delete app</button>
</form>
</section>`;
}

export function appView(data: AppPageData, origin: string, now: Date): Html {
	const { project } = data;
	const sub: Child = h`${platformLabel(project.platform)} · added ${time(project.created_at, now)} · <a href="/issues?project=${project.id}">Errors</a> · ${trustBadge(project, project.last_event_at !== null)}`;
	return h`<div class="page-head">
<div class="crumbs"><a href="/apps">Apps</a></div>
<h1>${t(project.name, 100)}${data.demo ? h` <span class="pill pill-demo">Demo data</span>` : ""}</h1>
<p>${sub}</p>
</div>
${project.trust === "low" ? lowTrustNote() : ""}
${tabs(project.id, data.tab)}
${
	data.tab === "manual"
		? manualTab(project, origin, data.sdk)
		: h`<div class="app-agent">
${checklist(data.progress, project.id)}
<section aria-labelledby="tasks-title"><h2 id="tasks-title">Ask your agent</h2><p class="muted">Copy a prompt and paste it into your coding agent. Each prompt names a recipe that your agent reads from this Checkend.</p>${taskCards(origin, project)}</section>
</div>`
}
${dangerZone(data)}`;
}
