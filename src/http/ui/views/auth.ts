import { type Html, h } from "../html.ts";
import { logo } from "../layout.ts";

const noScript = h`<p class="notice" data-no-js>Passkeys need JavaScript. Turn it on for this site.</p>`;

const GUIDE_URL = "https://github.com/Checkend/checkend/blob/main/guides/web-ui.md";

export function loginView({ devLogin }: { devLogin: boolean }): Html {
	return h`<div class="auth">
${logo("/login")}
<h1>Sign in</h1>
<p>Use the passkey that you made for this Checkend install.</p>
${noScript}
<button class="btn" type="button" data-passkey-signin data-js-only hidden>Sign in with a passkey</button>
<p class="status-line" id="auth-status" role="status" aria-live="polite"></p>
<p class="hint">No passkey for this install? Ask the admin to add you.</p>
${devLogin ? h`<p class="hint">Development mode: <a href="/dev/login">sign in as the local developer</a>.</p>` : ""}
</div>`;
}

/** The notice for a browser without a valid setup link. */
const setupMissing = (hidden: boolean) =>
	h`<div class="notice" data-setup-missing${hidden ? h` hidden` : ""}>
<p>This install is not set up yet. Open the setup link from your deploy output, or run <code>npm run setup-link</code>.</p>
<p><a href="${GUIDE_URL}">Read the web UI guide</a></p>
</div>`;

/**
 * "code": the setup link carries the code in the URL fragment; the client script reads it.
 * "dev": development mode on localhost, no code. "missing": SETUP_CODE is not set.
 * "expired": the code is older than 24 hours.
 */
export function setupView(mode: "code" | "dev" | "missing" | "expired"): Html {
	if (mode === "expired") {
		return h`<div class="auth">
${logo("/setup")}
<h1>Set up Checkend</h1>
<div class="notice"><p>This setup link has expired. Run <code>npm run setup-link</code> for a new one.</p>
<p><a href="${GUIDE_URL}">Read the web UI guide</a></p></div>
</div>`;
	}
	if (mode === "missing") {
		return h`<div class="auth">
${logo("/setup")}
<h1>Set up Checkend</h1>
${setupMissing(false)}
</div>`;
	}
	return h`<div class="auth">
${logo("/setup")}
<h1>Set up Checkend</h1>
<p>Make the first member of this install. After this step, setup closes, and you sign in with your passkey.</p>
${noScript}
${mode === "code" ? setupMissing(true) : ""}
<form data-passkey-setup${mode === "code" ? h` data-needs-code` : ""} data-js-only hidden>
<div class="field"><label for="s-name">Your name</label><input id="s-name" type="text" name="name" required maxlength="100" autocomplete="name"></div>
<button class="btn" type="submit">Create a passkey</button>
</form>
<p class="status-line" id="auth-status" role="status" aria-live="polite"></p>
</div>`;
}

export function setupClosedView(): Html {
	return h`<div class="auth">
${logo("/login")}
<h1>Setup is closed</h1>
<p>This install already has a member. Sign in with your passkey.</p>
<p><a class="btn" href="/login">Sign in</a></p>
</div>`;
}

export function notFoundView(): Html {
	return h`<div class="page-head"><h1>Not found</h1><p>This page does not exist, or it was removed.</p></div>
<p><a href="/">Go to the dashboard</a></p>`;
}
