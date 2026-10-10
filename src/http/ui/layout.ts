import { ASSETS } from "./assets/index.ts";
import { type Child, type Html, h } from "./html.ts";

const LOGO = h`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#7c3aed"/><path d="M24 16A8 8 0 1 1 21.66 10.34" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="22" cy="10" r="2.5" fill="#fff"/></svg>`;

export const logo = (href = "/issues"): Html =>
	h`<a class="logo" href="${href}" aria-label="Checkend home">${LOGO} checkend</a>`;

export type Section = "issues" | "projects" | "settings";

export interface PageOptions {
	title: string;
	/** The signed-in member, for the top bar. Null on sign-in and setup pages. */
	member?: { name: string; devMode: boolean } | null;
	section?: Section;
	body: Child;
}

const NAV: [Section, string, string][] = [
	["issues", "/issues", "Issues"],
	["projects", "/projects", "Projects"],
	["settings", "/settings", "Settings"],
];

/** The HTML document. Styles and the script are files: the CSP allows nothing inline. */
export function page({ title, member = null, section, body }: PageOptions): Html {
	return h`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${title} · Checkend</title>
<link rel="icon" href="${ASSETS.icon}" type="image/svg+xml">
<link rel="stylesheet" href="${ASSETS.css}">
<script src="${ASSETS.js}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${
	member
		? h`<header class="top">
  <div class="wrap top-inner">
    ${logo()}
    <nav aria-label="Primary">${NAV.map(
			([key, href, label]) =>
				h`<a href="${href}"${key === section ? h` aria-current="page"` : ""}>${label}</a>`,
		)}</nav>
    ${member.devMode ? h`<span class="dev-flag" title="CHECKEND_DEV is on">Development</span>` : ""}
    <span class="who">${member.name}</span>
  </div>
</header>`
		: ""
}
<main id="main" class="wrap">
${body}
</main>
${member ? h`<footer class="wrap foot">Checkend · open-source error tracking for coding agents</footer>` : ""}
</body>
</html>`;
}

/** A page heading with optional crumbs and a line below. */
export function pageHead(title: Child, sub?: Child, crumbs?: Child): Html {
	return h`<div class="page-head">
${crumbs ? h`<div class="crumbs">${crumbs}</div>` : ""}
<h1>${title}</h1>
${sub ? h`<p>${sub}</p>` : ""}
</div>`;
}

/**
 * A block of event data. Everything from an event goes in one of these: it is visibly marked
 * as untrusted data from production (it can contain instructions that are not ours).
 */
export function untrusted(title: string, content: Child): Html {
	const id = `data-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
	return h`<section class="untrusted" aria-labelledby="${id}">
<div class="untrusted-head"><h2 id="${id}">${title}</h2><span class="from-prod">Untrusted data from production</span></div>
${content}
</section>`;
}
