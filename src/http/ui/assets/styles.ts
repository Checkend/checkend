/** The UI stylesheet. Same tokens, type and tone as the home page (checkend.com). */
export const STYLES = `
:root {
  --bg: #ffffff;
  --fg: #171717;
  --muted: #666666;
  --line: #e6e6e6;
  --panel: #fafafa;
  --red: #c4262e;
  --amber: #a15c00;
  --green: #1a7f37;
  --blue: #0b57d0;
  --violet: #7c3aed;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e0e0e;
    --fg: #ededed;
    --muted: #a0a0a0;
    --line: #2a2a2a;
    --panel: #161616;
    --red: #ff6b6b;
    --amber: #f0b45a;
    --green: #5cc97a;
    --blue: #7aa7ff;
    --violet: #a78bfa;
  }
}

*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font-family: var(--sans); font-size: 15px; line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
a { color: inherit; text-underline-offset: 2px; }
:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; border-radius: 4px; }
code, pre, kbd, samp { font-family: var(--mono); }
code { font-size: 0.9em; }
h1, h2, h3 { font-weight: 600; letter-spacing: -0.02em; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.skip { position: absolute; left: 1rem; top: -3rem; background: var(--fg); color: var(--bg); padding: 0.4rem 0.8rem; border-radius: 6px; z-index: 5; }
.skip:focus { top: 0.75rem; }
.wrap { max-width: 1120px; margin-inline: auto; padding-inline: 24px; }
.muted { color: var(--muted); }
.mono { font-family: var(--mono); font-size: 13px; }

/* Top bar */
.top { border-bottom: 1px solid var(--line); }
.top-inner { display: flex; align-items: center; gap: 28px; min-height: 56px; }
.logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; font-size: 17px; letter-spacing: -0.01em; text-decoration: none; }
.logo svg { width: 20px; height: 20px; }
.top nav { display: flex; gap: 4px; flex: 1; }
.top nav a { text-decoration: none; color: var(--muted); padding: 6px 10px; border-radius: 999px; }
.top nav a:hover { color: var(--fg); }
.top nav a[aria-current="page"] { color: var(--fg); background: var(--panel); box-shadow: inset 0 0 0 1px var(--line); }
.who { font-size: 13px; color: var(--muted); }
.dev-flag { font-size: 12px; font-weight: 600; color: var(--amber); border: 1px solid currentColor; border-radius: 6px; padding: 1px 6px; }

main { padding-top: 28px; padding-bottom: 72px; }
.page-head { margin-bottom: 20px; }
.page-head h1 { font-size: 26px; line-height: 1.2; margin: 0 0 6px; overflow-wrap: anywhere; }
.page-head p { margin: 0; color: var(--muted); }
.crumbs { font-size: 13px; color: var(--muted); margin-bottom: 6px; }
.crumbs a { text-decoration: none; }
.crumbs a:hover { text-decoration: underline; }
h2 { font-size: 17px; margin: 0 0 12px; }

/* Buttons and fields */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  font: inherit; font-weight: 500; font-size: 14px; cursor: pointer; text-decoration: none;
  background: var(--fg); color: var(--bg); border: 1px solid var(--fg);
  padding: 7px 16px; border-radius: 999px; min-height: 36px;
}
.btn:hover { opacity: 0.85; }
.btn[disabled] { opacity: 0.5; cursor: progress; }
.btn-quiet { background: transparent; color: var(--fg); border-color: var(--line); }
.btn-quiet:hover { border-color: var(--muted); opacity: 1; }
.btn-small { font-size: 13px; padding: 3px 12px; min-height: 28px; }
label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
input[type="text"], input[type="search"], input[type="password"], select {
  font: inherit; font-size: 14px; color: var(--fg); background: var(--bg);
  border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-height: 36px; width: 100%;
}
input:hover, select:hover { border-color: var(--muted); }
.field { margin-bottom: 14px; }
.hint { font-size: 13px; color: var(--muted); margin: 4px 0 0; }
.error { color: var(--red); font-size: 14px; }
.status-line { min-height: 1.5em; font-size: 14px; margin: 12px 0 0; }

/* Filters */
.filters { display: grid; grid-template-columns: minmax(180px, 2fr) repeat(5, minmax(110px, 1fr)) auto; gap: 10px; align-items: end; margin-bottom: 18px; }
.filters .actions { display: flex; gap: 8px; align-items: center; }
.filters .actions a { font-size: 14px; color: var(--muted); }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-top: 1px solid var(--line); }
thead th { font-size: 12px; font-weight: 500; color: var(--muted); border-top: 0; padding-bottom: 6px; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; padding-right: 0; padding-left: 12px; white-space: nowrap; }
td.when { white-space: nowrap; color: var(--muted); }
tbody tr:last-child td { border-bottom: 1px solid var(--line); }

.issue-title { font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.issue-title:hover { text-decoration: underline; }
.issue-sub { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 2px; font-size: 12.5px; color: var(--muted); }
.issue-sub .mono { font-size: 12px; overflow-wrap: anywhere; }

.pill { display: inline-block; font-size: 12px; font-weight: 500; padding: 0 7px; border-radius: 6px; border: 1px solid currentColor; line-height: 1.6; white-space: nowrap; }
.pill-unresolved { color: var(--red); }
.pill-resolved { color: var(--green); }
.pill-ignored { color: var(--muted); }
.level { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.level-fatal, .level-error { color: var(--red); }
.level-warning { color: var(--amber); }
.level-info, .level-debug { color: var(--blue); }

.empty { padding: 40px 20px; text-align: center; border: 1px dashed var(--line); border-radius: 12px; color: var(--muted); }
.empty h2 { color: var(--fg); }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }

/* Facts */
.facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; margin: 0 0 24px; }
.facts div { background: var(--bg); padding: 10px 14px; }
.facts dt { font-size: 12px; color: var(--muted); }
.facts dd { margin: 2px 0 0; font-size: 15px; font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

.grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 28px; align-items: start; }
.stack > * + * { margin-top: 24px; }

/* Untrusted data from production */
.untrusted { border: 1px solid var(--line); border-left: 3px solid var(--amber); border-radius: 10px; padding: 14px 16px 16px; background: var(--bg); min-width: 0; }
.untrusted + .untrusted { margin-top: 20px; }
.untrusted-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 12px; margin-bottom: 10px; }
.untrusted-head h2 { margin: 0; }
.from-prod { font-size: 12px; color: var(--amber); font-weight: 500; }
.from-prod::before { content: "▲ "; font-size: 10px; }
.untrusted .value { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: var(--mono); font-size: 13px; }

/* Stack frames */
.exception + .exception { margin-top: 18px; padding-top: 14px; border-top: 1px dashed var(--line); }
.exc-type { font-family: var(--mono); font-weight: 600; font-size: 14px; overflow-wrap: anywhere; }
.exc-value { margin: 2px 0 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
.frames { list-style: none; margin: 0; padding: 0; }
.frame { border: 1px solid var(--line); border-radius: 8px; margin-bottom: 8px; overflow: hidden; }
.frame-head { display: flex; flex-wrap: wrap; gap: 2px 10px; padding: 6px 10px; background: var(--panel); font-family: var(--mono); font-size: 12.5px; }
.frame-head .fn { font-weight: 600; }
.frame-head .loc { color: var(--muted); overflow-wrap: anywhere; }
.frame.lib .frame-head { color: var(--muted); }
.frame-tag { font-family: var(--sans); font-size: 11px; color: var(--violet); font-weight: 600; }
.source { margin: 0; padding: 6px 0; font-size: 12.5px; line-height: 1.6; overflow-x: auto; }
.source span { display: block; padding: 0 10px; white-space: pre; }
.source span::before { content: attr(data-line); display: inline-block; width: 4.5ch; margin-right: 1.5ch; text-align: right; color: var(--muted); }
.source .hit { background: color-mix(in srgb, var(--red) 12%, transparent); }
details.lib-frames > summary { cursor: pointer; font-size: 13px; color: var(--muted); margin: 4px 0 8px; }

/* Key/value tables in event data */
.kv { font-size: 13px; }
.kv th { width: 30%; font-weight: 500; color: var(--muted); font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
.kv td { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; white-space: pre-wrap; }
pre.json { margin: 0; font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 420px; overflow: auto; }

/* Tags */
.tags { list-style: none; margin: 0; padding: 0; }
.tags li + li { margin-top: 12px; }
.tag-key { font-family: var(--mono); font-size: 12.5px; color: var(--muted); overflow-wrap: anywhere; }
.tag-row { display: grid; grid-template-columns: minmax(0, 1fr) 64px 3ch; gap: 8px; align-items: center; font-size: 13px; }
.tag-row .v { font-family: var(--mono); font-size: 12.5px; overflow-wrap: anywhere; }
.tag-row meter { width: 64px; height: 8px; }
.tag-row .n { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }

/* Lists of events and projects */
.list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--line); }
.list li { border-bottom: 1px solid var(--line); padding: 10px 0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 14px; }
.card { border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; background: var(--bg); }
.card + .card { margin-top: 16px; }
.card h2 a { text-decoration: none; }
.card h2 a:hover { text-decoration: underline; }
.dsn { display: flex; gap: 8px; align-items: stretch; margin-top: 6px; }
.dsn code { flex: 1; min-width: 0; display: block; padding: 7px 10px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; font-size: 12.5px; overflow-wrap: anywhere; }
pre.snippet { margin: 0; padding: 14px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; font-size: 12.5px; line-height: 1.7; overflow-x: auto; }
.snippet-head { display: flex; justify-content: space-between; align-items: center; margin: 20px 0 8px; }
.snippet-head h3 { font-size: 15px; margin: 0; }

/* Sign-in and setup */
.auth { max-width: 420px; margin: 8vh auto 0; padding-inline: 16px; }
.auth .logo { margin-bottom: 28px; }
.auth h1 { font-size: 28px; line-height: 1.15; margin: 0 0 8px; }
.auth p { color: var(--muted); }
.auth .btn { width: 100%; margin-top: 8px; min-height: 42px; font-size: 15px; }
.notice { font-size: 14px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }

.foot { border-top: 1px solid var(--line); padding-top: 16px; padding-bottom: 32px; font-size: 12.5px; color: var(--muted); }

/* Narrow screens */
@media (max-width: 900px) {
  .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filters .search, .filters .actions { grid-column: 1 / -1; }
  .grid-2 { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .wrap { padding-inline: 16px; }
  .top-inner { flex-wrap: wrap; gap: 4px 16px; padding-block: 8px; }
  .top nav { order: 3; flex-basis: 100%; overflow-x: auto; margin-inline: -10px; }
  .page-head h1 { font-size: 21px; }
  table.issues thead { display: none; }
  table.issues, table.issues tbody, table.issues tr { display: block; }
  table.issues tr { border-top: 1px solid var(--line); padding: 10px 0; }
  table.issues tbody tr:last-child { border-bottom: 1px solid var(--line); }
  table.issues td { display: inline; border: 0; padding: 0; }
  table.issues td.issue { display: block; margin-bottom: 4px; }
  table.issues td.num, table.issues td.when { font-size: 12.5px; color: var(--muted); padding: 0 12px 0 0; text-align: left; }
  table.issues td[data-label]::before { content: attr(data-label) " "; }
  .kv th { width: 40%; }
}
`;
