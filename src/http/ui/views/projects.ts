import type { ProjectSummary } from "../../../core/projects.ts";
import { type Html, h, time } from "../html.ts";
import { projectPath } from "../ids.ts";
import { pageHead } from "../layout.ts";
import { displayText as t } from "../text.ts";

export const PLATFORMS = ["node", "javascript", "python", "ruby", "php", "go", "other"] as const;

/** The DSN of a project key: the public key and the public project ID, on this host. */
export function dsnFor(origin: string, key: string, publicId: number): string {
	const url = new URL(origin);
	return `${url.protocol}//${key}@${url.host}/${publicId}`;
}

function dsnField(id: string, dsn: string): Html {
	return h`<div class="dsn"><code id="${id}">${dsn}</code><button class="btn btn-quiet btn-small" type="button" data-copy="${id}" data-js-only hidden>Copy</button></div>`;
}

export interface CreateForm {
	name?: string;
	platform?: string;
	error?: string;
}

function createForm(csrf: string, form: CreateForm): Html {
	return h`<form class="card" method="post" action="/projects" aria-labelledby="new-project">
<h2 id="new-project">New project</h2>
<input type="hidden" name="_csrf" value="${csrf}">
${form.error ? h`<p class="error" role="alert">${form.error}</p>` : ""}
<div class="field"><label for="p-name">Name</label><input id="p-name" type="text" name="name" required maxlength="100" value="${form.name ?? ""}" autocomplete="off"${form.error ? h` aria-invalid="true"` : ""}></div>
<div class="field"><label for="p-platform">Platform</label><select id="p-platform" name="platform">${PLATFORMS.map(
		(p) =>
			h`<option value="${p}"${p === (form.platform ?? "node") ? h` selected` : ""}>${p}</option>`,
	)}</select></div>
<button class="btn" type="submit">Create project</button>
</form>`;
}

export function projectsView(
	projects: ProjectSummary[],
	origin: string,
	csrf: string,
	now: Date,
	form: CreateForm = {},
): Html {
	return h`${pageHead("Projects", "Each project has a DSN. Put it in the Sentry SDK of an app.")}
<div class="grid-2">
<div>${
		projects.length === 0
			? h`<div class="empty"><h2>No projects yet</h2><p>Create one, then send an error from your app.</p></div>`
			: projects.map(
					(p) => h`<section class="card" aria-labelledby="project-${p.id}">
<h2 id="project-${p.id}"><a href="${projectPath(p.id)}">${t(p.name, 100)}</a></h2>
<p class="muted">${t(p.platform ?? "no platform", 32)} · ID <span class="mono">${p.id}</span> · created ${time(p.created_at, now)}</p>
${p.keys.slice(0, 1).map((key) => dsnField(`dsn-${p.id}`, dsnFor(origin, key, p.id)))}
</section>`,
				)
	}</div>
${createForm(csrf, form)}
</div>`;
}

// The package names are in constants, so that the source has no SDK import (Checkend never
// reports its own errors; test/node/self-reporting.test.ts checks the source).
const NODE_SDK = "@sentry/node";
const BROWSER_SDK = "@sentry/browser";

const nodeSnippet = (dsn: string) => `npm install ${NODE_SDK}

// instrument.mjs: import this file before any other code of your app.
import * as Sentry from "${NODE_SDK}";

Sentry.init({
  dsn: "${dsn}",
  environment: process.env.NODE_ENV,
  release: process.env.APP_RELEASE,
});`;

const browserSnippet = (dsn: string) => `npm install ${BROWSER_SDK}

import * as Sentry from "${BROWSER_SDK}";

Sentry.init({
  dsn: "${dsn}",
  environment: "production",
  release: "my-app@1.0.0",
});`;

/** One project: its DSN and the setup snippets. */
export function projectView(project: ProjectSummary, origin: string, now: Date): Html {
	const key = project.keys[0];
	const dsn = key ? dsnFor(origin, key, project.id) : null;
	return h`${pageHead(
		t(project.name, 100),
		h`${t(project.platform ?? "no platform", 32)} · ID <span class="mono">${project.id}</span> · created ${time(project.created_at, now)} · <a href="/issues?project=${project.id}">Issues</a>`,
		h`<a href="/projects">Projects</a>`,
	)}
${
	dsn
		? h`<section aria-labelledby="dsn-title">
<h2 id="dsn-title">DSN</h2>
${dsnField("dsn", dsn)}
<p class="hint">The DSN is not a secret: browser apps include it. It lets a client send errors; it does not give read access.</p>
<div class="snippet-head"><h3>Node.js</h3><button class="btn btn-quiet btn-small" type="button" data-copy="snippet-node" data-js-only hidden>Copy</button></div>
<pre class="snippet"><code id="snippet-node">${nodeSnippet(dsn)}</code></pre>
<div class="snippet-head"><h3>Browser</h3><button class="btn btn-quiet btn-small" type="button" data-copy="snippet-browser" data-js-only hidden>Copy</button></div>
<pre class="snippet"><code id="snippet-browser">${browserSnippet(dsn)}</code></pre>
<p class="hint">Any Sentry SDK works: use the same DSN in its <code>init</code> call.</p>
</section>`
		: h`<p class="notice">This project has no active DSN key.</p>`
}`;
}
