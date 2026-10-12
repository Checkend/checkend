# Alerts

Checkend can tell people about an issue in Slack, Discord, a GitHub issue or email: when an
issue is new, regressed, verified, or has a spike of events. An alert is a
[webhook](webhooks.md) with another `format`.

## Channels

| `format` | Target | Notes |
|---|---|---|
| `slack` | `url`: a Slack incoming webhook, `https://hooks.slack.com/services/...` | The URL is a secret: Checkend stores it encrypted and shows it masked. |
| `discord` | `url`: a Discord webhook, `https://discord.com/api/webhooks/<id>/<token>` | The URL is a secret, as for Slack. |
| `github_issue` | `url`: `https://api.github.com/repos/<owner>/<repo>/issues`, and `github_token` | The token needs **Issues: Read and write** on that repository. Checkend stores it encrypted. |
| `email` | `to`: 1 to 20 email addresses (no `url`) | Needs the email settings (see [Email](#email)). |

All alerts need `ENCRYPTION_KEYS` (see [Encryption keys](webhooks.md#encryption-keys)), and
all alert endpoints need the `admin` scope.

## Create an alert

```sh
curl -X POST "$CHECKEND_URL/v1/webhooks" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "team-slack", "format": "slack",
       "url": "https://hooks.slack.com/services/T0001/B0001/xxxx",
       "events": ["issue.new", "issue.regressed", "issue.spike"], "spike_threshold": 50}'
```

The other fields are the same as for a webhook: `name`, `events`, `min_trust` and `project`. See
[`POST /v1/webhooks`](api.md#post-v1webhooks).

To change an alert, delete it and create it again. There is no update.

## Events

| Event | When |
|---|---|
| `issue.new` | The first event of a new issue. |
| `issue.regressed` | A regression (a resolved issue gets an event, or the error comes back after a fix). |
| `issue.verified` | A fix is verified. |
| `issue.spike` | The events of an issue in the current clock hour go above `spike_threshold`. |

For `issue.spike`, set `spike_threshold` (1 to 1,000,000). Checkend sends one alert when the
events of the current clock hour go from the threshold to one more. It sends at most one spike
alert for each issue and hour. The hours are clock hours (UTC), not a rolling 60 minutes. A
repeated event does not start a spike alert.

## Message safety

The text of an error comes from production, and anyone who can send events can choose it. So
alerts show it with care:

- The text is only inside a code block, marked "From production (untrusted data)". It cannot
  close the block.
- Mentions do not notify anyone: `@channel`, `@here`, `@everyone`, `<!channel>`, and user and
  role mentions are plain text.
- Slack link syntax is plain text, and link previews are off. Discord embeds are off.
- An email subject is one line.
- A GitHub issue gets the [issue brief](mcp.md#the-issue-brief) (with its UNTRUSTED blocks)
  under a warning line, and the label `checkend`.

Alerts follow `min_trust` as webhooks do: by default (`high`), they skip
[low-trust](sending-errors.md#trust-and-allowed-origins) issues. A project is low trust when, in
the last 30 days, it got an event from a browser, a mobile app or an unknown SDK. To get alerts
for such a project, set its trust to `high`, or set the `min_trust` of the alert to `low`.

## Email

On Cloudflare, email alerts use the Email Service:

1. Add the binding to your Worker config:

   ```jsonc
   "send_email": [{ "name": "EMAIL" }]
   ```

2. Set the variable `EMAIL_FROM` to an address on a domain that is onboarded to the Email
   Service.

Without both, email alerts are off: creating one gives `400` `email_not_configured`. One message
goes to at most 50 recipients.

On Node (Docker), set `SMTP_URL` and `EMAIL_FROM` instead. With a user and password, `SMTP_URL`
must use TLS (`smtps://user:password@host:465`); `smtp://` is only for a local relay without
credentials. See [Run without Cloudflare](self-host.md#settings).

## See the alerts

`GET /v1/alerts` (with `issues:read`) and the MCP tool `list_alerts` list the alert rules. They do
not show secrets, email addresses (only their number), or the query strings of URLs. So an agent
can see which alerts exist, but it cannot read where they go.
