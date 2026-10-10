import type { NormalizedEvent } from "../../../core/ingest/normalize.ts";
import { type Html, h, time } from "../html.ts";
import { issuePath } from "../ids.ts";
import { pageHead, untrusted } from "../layout.ts";
import { displayText as t } from "../text.ts";
import {
	breadcrumbs,
	eventSummary,
	exceptions,
	jsonBlock,
	keyValues,
	requestBlock,
} from "./event-parts.ts";
import { eventMeta } from "./issues.ts";

export interface EventDetail {
	id: number;
	issue_id: number;
	issue_title: string;
	event: NormalizedEvent;
}

const hasKeys = (value: Record<string, unknown> | null): value is Record<string, unknown> =>
	value !== null && Object.keys(value).length > 0;

/** One stored event, every section. Each section is untrusted data. */
export function eventView(detail: EventDetail, now: Date): Html {
	const e = detail.event;
	const lastValue = e.exceptions.at(-1)?.value;
	return h`${pageHead(
		eventSummary(e),
		h`Event <span class="mono">${t(e.event_id, 64)}</span> · ${time(e.timestamp, now)}${e.truncated ? " · cut to the size limit" : ""}`,
		h`<a href="/issues">Issues</a> / <a href="${issuePath(detail.issue_id)}">${t(detail.issue_title, 120)}</a>`,
	)}
<div class="stack">
${e.exceptions.length > 0 ? untrusted("Exception", exceptions(e.exceptions, true)) : ""}
${e.message && e.message !== lastValue ? untrusted("Message", h`<p class="value">${t(e.message, 8192)}</p>`) : ""}
${e.request ? untrusted("Request", requestBlock(e.request)) : ""}
${e.tags.length > 0 ? untrusted("Tags", keyValues(e.tags)) : ""}
${hasKeys(e.user) ? untrusted("User", jsonBlock(e.user)) : ""}
${e.breadcrumbs.length > 0 ? untrusted("Breadcrumbs", breadcrumbs(e.breadcrumbs)) : ""}
${hasKeys(e.contexts) ? untrusted("Contexts", jsonBlock(e.contexts)) : ""}
${hasKeys(e.extra) ? untrusted("Extra", jsonBlock(e.extra)) : ""}
${untrusted("Event", eventMeta(e))}
</div>`;
}
