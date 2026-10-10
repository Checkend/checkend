import type { Health } from "../../../core/health.ts";
import type { IngestStatus } from "../../../core/ingest-status.ts";
import { count, type Html, h, time } from "../html.ts";
import { pageHead } from "../layout.ts";
import { displayText as t } from "../text.ts";

export interface MemberRow {
	name: string;
	created_at: string;
	passkeys: number;
	last_used_at: string | null;
}

export interface SettingsData {
	health: Health;
	ingest: IngestStatus | null;
	members: MemberRow[];
	session: { memberName: string; expiresAt: string; csrfToken: string };
	devMode: boolean;
}

const fact = (label: string, value: Html | string) => h`<div><dt>${label}</dt>
<dd>${value}</dd></div>`;

export function settingsView(data: SettingsData, now: Date): Html {
	const { health, ingest } = data;
	return h`${pageHead("Settings", "The state of this install, and who can sign in.")}
<div class="stack">
<section aria-labelledby="health-title">
<h2 id="health-title">Health</h2>
<dl class="facts">
${fact("Status", health.status)}
${fact("Version", health.version)}
${fact("Migration", health.migrations ? (health.migrations.latest ?? "none") : "unknown")}
${fact("Ingest mode", ingest ? (ingest.mode === "full" ? "full" : "counters only (budget mode until 00:00 UTC)") : "unknown")}
${fact("Events today", ingest ? count(ingest.events_received_today) : "—")}
${fact("Rows written today", ingest ? `${count(ingest.rows_written_today)}${ingest.daily_row_limit ? ` of ${count(ingest.daily_row_limit)}` : ""}` : "—")}
${fact("Write failures today", ingest ? count(ingest.write_failures_today) : "—")}
${fact("Retry after", ingest && ingest.retry_after_seconds > 0 ? `${ingest.retry_after_seconds} s (database overloaded)` : "—")}
</dl>
</section>
<section aria-labelledby="members-title">
<h2 id="members-title">Members</h2>
<table>
<thead><tr><th scope="col">Name</th><th scope="col" class="num">Passkeys</th><th scope="col">Last passkey use</th><th scope="col">Added</th></tr></thead>
<tbody>${data.members.map(
		(m) =>
			h`<tr><td>${t(m.name, 100)}</td><td class="num">${m.passkeys}</td><td class="when">${time(m.last_used_at, now)}</td><td class="when">${time(m.created_at, now)}</td></tr>`,
	)}</tbody>
</table>
<p class="hint">More members, API tokens and releases come in a later version.</p>
</section>
<section aria-labelledby="session-title">
<h2 id="session-title">This session</h2>
<p>Signed in as <strong>${t(data.session.memberName, 100)}</strong>. The session ends ${data.session.expiresAt.slice(0, 10)}.</p>
${data.devMode ? h`<p class="notice">Development mode is on (<code>CHECKEND_DEV</code>). <code>/dev/login</code> signs in without a passkey on localhost.</p>` : ""}
<form method="post" action="/logout"><input type="hidden" name="_csrf" value="${data.session.csrfToken}"><button class="btn btn-quiet" type="submit">Sign out</button></form>
</section>
</div>`;
}
