import type { TokenListItem } from "../../../core/tokens.ts";
import { type Html, h, time } from "../html.ts";
import { pageHead } from "../layout.ts";
import { displayText as t } from "../text.ts";

/**
 * The scopes that the Tokens page offers. Never admin: an admin token from a browser form is
 * too much power (the API and ADMIN_TOKEN still make one).
 */
export const UI_TOKEN_SCOPES = [
	{ field: "scope_issues_read", scope: "issues:read", label: "Read issues and events" },
	{ field: "scope_issues_write", scope: "issues:write", label: "Change issues: claim, link a fix" },
	{
		field: "scope_releases_write",
		scope: "releases:write",
		label: "Report deploys and upload source maps (CI)",
	},
] as const;

export interface TokensPageData {
	tokens: TokenListItem[];
	apps: { id: number; name: string }[];
	csrf: string;
	/** The new token: shown once, right after it was made. */
	created?: { name: string; token: string } | null;
	error?: string | null;
	notice?: string | null;
}

function createdBox(created: { name: string; token: string }): Html {
	return h`<section class="token-new" aria-labelledby="new-token-title" role="status">
<h2 id="new-token-title">Token “${t(created.name, 100)}” made</h2>
<p>Copy it now. Checkend stores only a hash, so it cannot show the token again.</p>
<div class="dsn"><code id="new-token">${created.token}</code><button class="btn btn-quiet btn-small" type="button" data-copy="new-token" data-js-only hidden>Copy</button></div>
</section>`;
}

function createForm(data: TokensPageData): Html {
	return h`<section aria-labelledby="create-title">
<h2 id="create-title">Make a token</h2>
<form method="post" action="/settings/tokens" class="stack-form">
<input type="hidden" name="_csrf" value="${data.csrf}">
${data.error ? h`<p class="error" role="alert">${data.error}</p>` : ""}
<div class="field"><label for="token-name">Name</label><input id="token-name" type="text" name="name" required maxlength="100" autocomplete="off" spellcheck="false" placeholder="GitHub Actions"></div>
<fieldset class="field"><legend>Scopes</legend>
${UI_TOKEN_SCOPES.map(
	(s) =>
		h`<label class="check"><input type="checkbox" name="${s.field}" value="1"> <code>${s.scope}</code> <span class="muted">${s.label}</span></label>`,
)}
</fieldset>
<div class="field"><label for="token-app">App</label><select id="token-app" name="project">
<option value="">All apps</option>
${data.apps.map((a) => h`<option value="${String(a.id)}">${t(a.name, 100)}</option>`)}
</select>
<p class="hint">A token for one app reports deploys and uploads source maps only for that app.</p></div>
<button class="btn" type="submit">Make token</button>
</form>
</section>`;
}

function tokenRow(token: TokenListItem, csrf: string, now: Date): Html {
	return h`<tr>
<td class="name">${t(token.name, 100)}</td>
<td data-label="Scopes:">${token.scopes.map((s) => h`<code>${s}</code> `)}</td>
<td data-label="App:">${token.project_name === null ? "All apps" : t(token.project_name, 100)}</td>
<td class="mono" data-label="Prefix:">${token.prefix}…</td>
<td class="when" data-label="Created:">${time(token.created_at, now)}</td>
<td class="when" data-label="Last used:">${token.last_used_at ? time(token.last_used_at, now) : "never"}</td>
<td class="actions"><details class="confirm"><summary>Revoke</summary>
<form method="post" action="/settings/tokens/${String(token.id)}/revoke">
<input type="hidden" name="_csrf" value="${csrf}">
<p>Revoke “${t(token.name, 100)}”? Scripts and agents that use it stop working at once.</p>
<button class="btn btn-danger btn-small" type="submit">Revoke token</button>
</form></details></td>
</tr>`;
}

export function tokensView(data: TokensPageData, now: Date): Html {
	const active = data.tokens.filter((token) => token.revoked_at === null);
	return h`${pageHead("Tokens", "API tokens for scripts, CI and agents.", h`<a href="/settings">Settings</a>`)}
<div class="stack">
${data.created ? createdBox(data.created) : ""}
${data.notice ? h`<p class="notice" role="status">${data.notice}</p>` : ""}
${createForm(data)}
<section aria-labelledby="tokens-title">
<h2 id="tokens-title">Active tokens</h2>
${
	active.length === 0
		? h`<p class="muted">No tokens yet.</p>`
		: h`<table class="tokens">
<thead><tr><th scope="col">Name</th><th scope="col">Scopes</th><th scope="col">App</th><th scope="col">Prefix</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
<tbody>${active.map((token) => tokenRow(token, data.csrf, now))}</tbody>
</table>`
}
</section>
</div>`;
}
