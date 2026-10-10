import type {
	NormalizedEvent,
	NormalizedException,
	NormalizedFrame,
} from "../../../core/ingest/normalize.ts";
import { type Child, type Html, h } from "../html.ts";
import { displayText } from "../text.ts";

/** Event data is untrusted: every value below goes through displayText() and is escaped. */
const t = (value: unknown, max?: number) => displayText(value, max);

function sourceLines(frame: NormalizedFrame): Html | "" {
	if (frame.context_line === null) return "";
	const line = frame.lineno ?? 0;
	const pre = frame.pre_context;
	const rows = [
		...pre.map((text, i) => ({ n: line - pre.length + i, text, hit: false })),
		{ n: line, text: frame.context_line, hit: true },
		...frame.post_context.map((text, i) => ({ n: line + 1 + i, text, hit: false })),
	];
	return h`<pre class="source"><code>${rows.map(
		(r) =>
			h`<span${r.hit ? h` class="hit"` : ""} data-line="${r.n > 0 ? r.n : ""}">${t(r.text, 400)}</span>`,
	)}</code></pre>`;
}

function frameItem(frame: NormalizedFrame): Html {
	const where = frame.filename ?? frame.abs_path ?? frame.module ?? "?";
	const position = frame.lineno ? `:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}` : "";
	return h`<li class="frame${frame.in_app ? "" : " lib"}">
<div class="frame-head"><span class="fn">${t(frame.function ?? "<anonymous>", 300)}</span><span class="loc">${t(where, 500)}${position}</span>${frame.in_app ? h`<span class="frame-tag">in app</span>` : ""}</div>
${sourceLines(frame)}
</li>`;
}

/** Frames, the frame that raised the error first. `allFrames` false: in-app frames only. */
export function frames(list: NormalizedFrame[], allFrames: boolean): Html {
	const recentFirst = [...list].reverse();
	const inApp = recentFirst.filter((f) => f.in_app === true);
	if (!allFrames) {
		if (inApp.length === 0) {
			return h`<p class="muted">No in-app frames. The event page has all ${list.length} frames.</p>`;
		}
		return h`<ol class="frames">${inApp.map(frameItem)}</ol>`;
	}
	const lib = recentFirst.filter((f) => f.in_app !== true);
	return h`<ol class="frames">${(inApp.length > 0 ? inApp : recentFirst).map(frameItem)}</ol>
${
	inApp.length > 0 && lib.length > 0
		? h`<details class="lib-frames"><summary>${lib.length} other frames (libraries and runtime)</summary><ol class="frames">${lib.map(frameItem)}</ol></details>`
		: ""
}`;
}

/** The exception chain: the error that was raised first, then its causes. */
export function exceptions(list: NormalizedException[], allFrames: boolean): Html {
	const raisedFirst = [...list].reverse();
	return h`${raisedFirst.map(
		(e, i) => h`<div class="exception">
${i > 0 ? h`<p class="muted">Caused by</p>` : ""}
<div class="exc-type">${t(e.type ?? "Error", 300)}</div>
${e.value ? h`<p class="exc-value">${t(e.value, 4000)}</p>` : ""}
${e.mechanism ? h`<p class="muted mono">mechanism: ${t(e.mechanism.type ?? "unknown")}${e.mechanism.handled === false ? " · unhandled" : ""}</p>` : ""}
${frames(e.frames, allFrames)}
</div>`,
	)}`;
}

/** A two-column table of untrusted keys and values. */
export function keyValues(rows: [unknown, unknown][]): Html | "" {
	if (rows.length === 0) return "";
	return h`<table class="kv"><tbody>${rows.map(
		([k, v]) =>
			h`<tr><th scope="row">${t(k, 300)}</th><td>${t(typeof v === "string" ? v : JSON.stringify(v), 4000)}</td></tr>`,
	)}</tbody></table>`;
}

/** Free-form JSON (contexts, extra, user), shown as text. */
export const jsonBlock = (value: unknown): Html =>
	h`<pre class="json"><code>${t(JSON.stringify(value, null, 2), 20000)}</code></pre>`;

export function requestBlock(request: NonNullable<NormalizedEvent["request"]>): Html {
	// The URL is text, never a link: it is untrusted (it can be javascript: or a phishing URL).
	return h`<p class="value">${t(request.method ?? "GET", 20)} ${t(request.url ?? "", 2048)}</p>
${request.query_string ? h`<p class="value muted">?${t(request.query_string, 2048)}</p>` : ""}
${request.headers.length > 0 ? h`<h3 class="muted mono">Headers</h3>${keyValues(request.headers)}` : ""}`;
}

export function breadcrumbs(list: NormalizedEvent["breadcrumbs"]): Html {
	return h`<table class="kv"><thead><tr><th scope="col">Time · category</th><th scope="col">Message</th></tr></thead><tbody>${list.map(
		(b) =>
			h`<tr><th scope="row">${t(b.timestamp?.slice(11, 19) ?? "")} ${t(b.category ?? b.type ?? "")}</th><td>${t(b.message ?? (b.data === undefined || b.data === null ? "" : JSON.stringify(b.data)), 2000)}</td></tr>`,
	)}</tbody></table>`;
}

/** The title of an event's issue line: type and value of the raised error, or the message. */
export function eventSummary(event: NormalizedEvent): Child {
	const last = event.exceptions.at(-1);
	if (last) return `${t(last.type ?? "Error", 200)}: ${t(last.value, 300)}`;
	return t(event.message ?? "(no message)", 300);
}
