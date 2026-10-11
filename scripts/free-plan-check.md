# Full-flow check on a Workers Free account

A person runs this check after a new install, to confirm that Checkend works on the Workers Free
plan. It creates one project and deletes it at the end.

## 1. Install

1. Use a Cloudflare account on the Workers Free plan.
2. Install Checkend with `npx create-checkend <name>` (or the Deploy to Cloudflare button).
3. Set the daily row limit of the Free plan, then deploy again:

   ```sh
   npx wrangler secret put D1_DAILY_ROW_LIMIT --config wrangler.<name>.jsonc   # 100000
   ```

## 2. Run the script

```sh
CHECKEND_URL=https://<name>.<subdomain>.workers.dev CHECKEND_ADMIN_TOKEN=<token> \
  node scripts/free-plan-check.ts
```

Every line must say `PASS`:

| Step | What it checks |
|---|---|
| health | `/health` answers, with all migrations applied. |
| setup key and app | A setup key registers an app and gets its DSN. |
| agent token and test event | The agent token, the test event, and the SDK report. |
| SDK event to issue | A real Sentry SDK request becomes an issue. |
| MCP brief | `get_issue_brief` over MCP. |
| fix and deploy | A fix link and a deploy that contains it. |
| progress | The setup progress has every step. |
| delete and key stop | The delete, and `401` for the old DSN key within about a minute. |

## 3. Check the Cloudflare dashboard

In Workers & Pages > your Worker:

- [ ] **Metrics > CPU time:** the median and the 99th percentile stay below 10 ms (the Free plan
      limit per request).
- [ ] **Logs:** no `checkend:` errors from the run.
- [ ] **Settings > Triggers:** the Cron Trigger `*/5 * * * *` ran in the last 10 minutes.

In Storage & Databases > D1 > your database:

- [ ] **Metrics:** the rows written by the run are a small part of the 100,000 rows per day.
- [ ] `/health` shows the budget mode as normal (not "counters only").

Write down the date, the Checkend version (`/health`), and any failed step.
