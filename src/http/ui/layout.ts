import { ASSETS } from "./assets/index.ts";
import { type Child, type Html, h } from "./html.ts";

const LOGO = h`<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#7c3aed"/><path d="M24 16A8 8 0 1 1 21.66 10.34" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="22" cy="10" r="2.5" fill="#fff"/></svg>`;

export const logo = (href = "/"): Html =>
	h`<a class="logo" href="${href}" aria-label="Checkend home">${LOGO} checkend</a>`;

export type Section = "home" | "issues" | "apps" | "settings";

/** The signed-in member and the badges of the sidebar. */
export interface Member {
	name: string;
	devMode: boolean;
	/** For the sign-out form. */
	csrf: string;
	/** The badge on Home: "Setup 3/5", "Start", or null when every app is set up. */
	setup: string | null;
	/** Unresolved issues first seen in the last 24 hours. */
	newIssues: number;
}

export interface PageOptions {
	title: string;
	/** The signed-in member, for the sidebar. Null on sign-in and setup pages. */
	member?: Member | null;
	section?: Section;
	body: Child;
}

const DOCS_URL = "https://github.com/Checkend/checkend/tree/main/guides";

// 16 px line icons. Decorative: each link has a text label.
const icon = (path: Html): Html =>
	h`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICONS = {
	home: icon(h`<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>`),
	issues: icon(h`<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>`),
	apps: icon(
		h`<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>`,
	),
	settings: icon(
		h`<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>`,
	),
	docs: icon(
		h`<path d="M4 4h6a2 2 0 0 1 2 2v14a1.5 1.5 0 0 0-1.5-1.5H4z"/><path d="M20 4h-6a2 2 0 0 0-2 2v14a1.5 1.5 0 0 1 1.5-1.5H20z"/>`,
	),
	menu: icon(h`<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>`),
};

function navLink(
	section: Section | undefined,
	key: Section,
	href: string,
	label: string,
	badge?: Html,
): Html {
	return h`<a href="${href}"${key === section ? h` aria-current="page"` : ""}>${ICONS[key]}<span class="side-label">${label}</span>${badge ?? ""}</a>`;
}

/** The sidebar: the product, the primary pages, and the account at the bottom. */
function sidebar(member: Member, section: Section | undefined): Html {
	const setupBadge = member.setup
		? h`<span class="badge badge-setup">${member.setup}</span>`
		: undefined;
	const issuesBadge =
		member.newIssues > 0
			? h`<span class="badge" aria-hidden="true">${member.newIssues > 99 ? "99+" : member.newIssues}</span><span class="sr">, ${member.newIssues} new</span>`
			: undefined;
	return h`<aside class="side">
<div class="side-head">
${logo()}
${member.devMode ? h`<span class="dev-flag" title="CHECKEND_DEV is on">Development</span>` : ""}
<button class="side-toggle" type="button" aria-controls="side-nav" aria-expanded="false" data-js-only hidden>${ICONS.menu}<span class="sr">Menu</span></button>
</div>
<div class="side-body" id="side-nav">
<nav class="side-nav" aria-label="Primary">
${navLink(section, "home", "/", "Home", setupBadge)}
${navLink(section, "issues", "/issues", "Issues", issuesBadge)}
${navLink(section, "apps", "/apps", "Apps")}
</nav>
<div class="side-foot">
${navLink(section, "settings", "/settings", "Settings")}
<a href="${DOCS_URL}" rel="noopener">${ICONS.docs}<span class="side-label">Docs</span></a>
<form class="side-account" method="post" action="/logout">
<input type="hidden" name="_csrf" value="${member.csrf}">
<span class="who" title="${member.name}">${member.name}</span>
<button class="link-button" type="submit">Sign out</button>
</form>
</div>
</div>
</aside>`;
}

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
		? h`<div class="shell">
${sidebar(member, section)}
<main id="main" class="content">
${body}
</main>
</div>
<p class="sr" id="copy-status" role="status" aria-live="polite"></p>`
		: h`<main id="main" class="wrap">
${body}
</main>`
}
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
