# Web UI

Checkend has a small web UI for people: sign in with a passkey, connect your apps, and read the
errors. Coding agents keep the [MCP server](mcp.md) and the [API](api.md).

## 1. Set up the first member

The first person who signs in is the first **member**. Setup uses a one-time setup link:

```sh
npm run setup-link -- --url https://<your-worker>
```

The script asks `/health` whether setup is open. If it is, it stores a random code as the
`SETUP_CODE` secret (with `wrangler secret put`) and prints the link
`https://<your-worker>/setup#<code>`. `npm run deploy` runs it after each deploy.

Open the link, type your name, and create a passkey. Then setup closes for good.

> **Note:** On Node and Docker, the setup link is not available yet. Until then, use development mode only
> on a local machine, or deploy on Cloudflare.

- The link works once, for 24 hours. Run `npm run setup-link` again for a new link.
- The code is in the URL fragment, so the browser does not send it in a URL.
- `/health` shows `setup_open: true` until the first member exists.
- The `ADMIN_TOKEN` does not open the web UI. The web UI never uses bearer tokens.

> **Caution:** a passkey works only on the host name where you made it. Make it on the host name
> that people will use every day. Behind a proxy, set [`PUBLIC_URL`](settings.md#public_url) first.

More members, API tokens and releases in the web UI come in a later version.

## 2. Sign in

Open `/login` and use your passkey. A session lasts 14 days. **Sign out** ends it.

Each client gets at most 20 sign-in and setup tries in 15 minutes (then `429` `rate_limited`, with
`Retry-After`). All clients together get at most 500.

## 3. Connect your apps

**Home** (`/`) shows the setup prompt and a checklist for each app, until every app is set up.
Then it opens the issues.

**Copy prompt** makes a new [setup key](agent-setup.md) and copies a prompt for your coding
agent. Paste it in the repository of your app:

```text
Set up Checkend error tracking for this app.
1. If `ce` is not installed, install it: https://<your-worker>/agent/install
2. Run `ce setup --url https://<your-worker>` with the setup key in the environment variable CHECKEND_SETUP_KEY.
   Never pass the key as an argument (--key), and never write it to a file, a commit or a log.
3. Follow the steps that `ce setup` prints.

Setup key (valid for 1 hour): cks_…
```

The key is on a line of its own, not in a command. The agent passes it to `ce setup` only in
`CHECKEND_SETUP_KEY`.

> **Caution:** treat the prompt as a secret. Its setup key can add apps, send a test error, and
> make agent tokens that read and change issues.

**Apps** (`/apps`) lists your apps and their setup steps. Without a coding agent, use
**Add an app**: type a name (1 to 100 characters) and a platform. The **manual** tab of the app
then shows its DSN (the UI calls it the "app key") and the SDK setup.

Each app shows its source and [trust](sending-errors.md#trust-and-allowed-origins), on the Apps
list and on its page: "Server SDK · High trust", "Browser · Low trust", "Mixed · Low trust", or
"No events yet". "(set by hand)" means that an admin set the trust. The page of a low-trust app
says how to improve it, and how to get its alerts again.

To delete an app, type its name to confirm. When `REQUIRE_APPROVAL` contains `delete_project`,
the delete waits for an [approval](api.md#approvals).

## 4. Read the errors

**Issues** (`/issues`) is the inbox, 50 issues on each page. Filter by app, status, environment,
release, last seen (last hour, 24 hours, 7 days or 30 days), and text. The app filter shows
only apps that are not deleted.

An issue page shows the latest event, the last 20 events, the tags, and the source and trust of
its app. An event page shows one event. The web UI shows event data as text: it never runs it as
HTML. Each block of event data has the label "From your app" with an ⓘ: it explains that the data
comes from the events of your app, that Checkend shows it as plain text and never runs it, and
that agents treat it as data, not as instructions.

### Fix an issue and change its status

An open issue (unresolved or regressed) has a **Fix this** block:

- **Copy prompt for your agent** copies a prompt for your coding agent. The prompt names the
  issue by its ID and URL only, never by its title or event data, and it contains no secret. The
  agent reads the brief (`ce issue view <id>` or the MCP tool `get_issue_brief`), claims the
  issue (`claim_issue`), fixes it with a test, and links the fix (`link_fix`).
- **Do it yourself with the CLI** shows the same steps as commands: `ce issue view <id>`, and
  `curl` calls to claim the issue and link the fix. Put an API token with `issues:write` in
  `CHECKEND_TOKEN`.

Every member can act on an issue. The page uses the same functions as the
[API](api.md), and the activity of the issue shows the member as the actor:

| Action | Shown when | What it does |
|---|---|---|
| **Claim** | The issue is open and nobody holds a claim. | The signed-in member holds the claim for 2 hours. The page shows who holds a claim and when it expires. |
| **Release** | You hold the claim. An owner can also release the claim of another actor, after a confirmation. | Ends the claim. |
| **Resolve** | The issue is open. | Closes the issue by hand. A new event opens it again. |
| **Ignore** | The issue is open. You confirm it first. | New events do not open the issue again. When `REQUIRE_APPROVAL` contains `ignore`, it waits for an [approval](api.md#approvals). |
| **Unresolve** | The issue is resolved or ignored. | Opens the issue again. |

A manual **Resolve** is not a verified fix. Only Checkend verifies a fix: after a deploy that
contains a linked fix, when the error stops for the quiet period (see [Verification](fix-loop.md#verification)).
An issue with a linked fix (`fix_pending`) or a verified fix has no status buttons.

**Settings** shows `/health`, the ingest state, and the members with their passkeys.

## Tokens

**Settings → Tokens** (`/settings/tokens`) makes API tokens, for example a token for CI. Only an
owner can open it: on a self-hosted install, every member; in a hosted space, an owner.

1. Give the token a name.
2. Choose its scopes: `issues:read`, `issues:write` and `releases:write`. The page never makes an
   `admin` token.
3. Choose an app, or all apps. A token for one app reports deploys and uploads source maps only
   for that app.
4. Copy the token. Checkend shows it only once.

The list shows the name, the scopes, the app, the first characters of each token, and when it was
made and last used. **Revoke** stops a token at once, after a confirmation.

## A hosted space

Checkend can also run as a hosted install: each space is one Checkend under its own path, on a
shared host. In a hosted space:

- you sign in and switch spaces with your account, outside the space. The space has no
  passkeys, no sign-in page and no setup link.
- an owner can do everything. A member reads and changes issues and sets up apps, but cannot
  delete an app or make tokens.
- the space updates itself: you do not run `ce server` or migrations.
- the API, the DSNs, `ce` and MCP work as on a self-hosted install, with the URL of the space
  (for example `https://<host>/<space>`).

## Security

- Sessions use a `__Host-` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`).
- Each form has a CSRF token, and each `POST` must come from the same origin. With `PUBLIC_URL`,
  the origin is `PUBLIC_URL`, else the origin of the request.
- The body of each `POST` of the web UI is at most 1 MB, also with chunked bodies. Above that,
  the answer is `413` `{"error": "payload_too_large", "max_bytes": 1048576}`.
- A strict Content Security Policy: no inline script or style.
