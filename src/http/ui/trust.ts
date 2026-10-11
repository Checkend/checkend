import type { Source, Trust } from "../../core/trust.ts";
import { type Html, h } from "./html.ts";

/** The source trust of an app, as the UI shows it (core/trust.ts). Fixed text only. */
export interface TrustView {
	trust: Trust;
	source: Source;
}

const SOURCE_LABEL = { server: "Server SDK", browser: "Browser", mixed: "Mixed" } as const;

/** "Server SDK · High trust", "Browser · Low trust", ..., or "No events yet". */
export function trustLabel(view: TrustView, hasEvents: boolean): string {
	if (view.source === null && !hasEvents) return "No events yet";
	// The automatic trust of the source; a different trust is the admin setting.
	const automatic = view.source === "browser" || view.source === "mixed" ? "low" : "high";
	const where = view.source === null ? "Source not known yet" : SOURCE_LABEL[view.source];
	const level = view.trust === "low" ? "Low trust" : "High trust";
	return `${where} · ${level}${view.trust === automatic ? "" : " (set by hand)"}`;
}

export function trustBadge(view: TrustView, hasEvents: boolean): Html {
	const state = view.source === null && !hasEvents ? "none" : view.trust;
	return h`<span class="trust trust-${state}" data-trust="${state}">${trustLabel(view, hasEvents)}</span>`;
}

/** How to improve a low-trust app, and how to get its alerts again. */
export function lowTrustNote(): Html {
	return h`<section class="trust-note" aria-labelledby="trust-title" data-trust-note>
<h2 id="trust-title">Low trust</h2>
<p>This app gets events from a browser, a mobile app or an unknown SDK. Anyone can read its app key there and send fake events with it. Alerts with the default minimum trust (high) do not fire for this app.</p>
<p>To improve:</p>
<ul>
<li>Send browser events to a separate app. Keep this app for server events.</li>
<li>Report important errors from a server SDK.</li>
</ul>
<p>To get alerts again, ask your agent to set the trust of this app to high, or to set the minimum trust of an alert to low.</p>
</section>`;
}
