import { type Html, h } from "../html.ts";
import { logo } from "../layout.ts";

const noScript = h`<p class="notice" data-no-js>Passkeys need JavaScript. Turn it on for this site.</p>`;

export function loginView(): Html {
	return h`<div class="auth">
${logo("/login")}
<h1>Sign in</h1>
<p>Use the passkey that you made for this Checkend install.</p>
${noScript}
<button class="btn" type="button" data-passkey-signin data-js-only hidden>Sign in with a passkey</button>
<p class="status-line" id="auth-status" role="status" aria-live="polite"></p>
</div>`;
}

export function setupView(): Html {
	return h`<div class="auth">
${logo("/setup")}
<h1>Set up Checkend</h1>
<p>Make the first member of this install. You need the <code>ADMIN_TOKEN</code> secret of the Worker once. After this step, setup closes, and you sign in with your passkey.</p>
${noScript}
<form data-passkey-setup data-js-only hidden>
<div class="field"><label for="s-name">Your name</label><input id="s-name" type="text" name="name" required maxlength="100" autocomplete="name"></div>
<div class="field"><label for="s-token">Admin token</label><input id="s-token" type="password" name="token" required autocomplete="off"><p class="hint">Checkend does not store it. It only checks it.</p></div>
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
<p><a href="/issues">Go to the issues</a></p>`;
}
