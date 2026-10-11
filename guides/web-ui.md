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
2. Run: CHECKEND_SETUP_KEY=cks_… ce setup --url https://<your-worker>
   The key is valid for 1 hour. Keep it only in CHECKEND_SETUP_KEY: never in a file or a commit.
3. Follow the steps that `ce setup` prints.
```

> **Caution:** treat the prompt as a secret. Its setup key can add apps, send a test error, and
> make agent tokens that read and change issues.

**Apps** (`/apps`) lists your apps and their setup steps. Without a coding agent, use
**Add an app**: type a name (1 to 100 characters) and a platform. The **manual** tab of the app
then shows its DSN (the UI calls it the "app key") and the SDK setup.

To delete an app, type its name to confirm. When `REQUIRE_APPROVAL` contains `delete_project`,
the delete waits for an [approval](api.md#approvals).

## 4. Read the errors

**Issues** (`/issues`) is the inbox, 50 issues on each page. Filter by app, status, environment,
release, last seen (last hour, 24 hours, 7 days or 30 days), and text. The app filter shows
only apps that are not deleted.

An issue page shows the latest event, the last 20 events and the tags. An event page shows one
event. The web UI shows event data as text: it never runs it as HTML.

**Settings** shows `/health`, the ingest state, and the members with their passkeys.

## Security

- Sessions use a `__Host-` cookie (`HttpOnly`, `Secure`, `SameSite=Strict`).
- Each form has a CSRF token, and each `POST` must come from the same origin. With `PUBLIC_URL`,
  the origin is `PUBLIC_URL`, else the origin of the request.
- The body of each `POST` of the web UI is at most 1 MB, also with chunked bodies. Above that,
  the answer is `413` `{"error": "payload_too_large", "max_bytes": 1048576}`.
- A strict Content Security Policy: no inline script or style.
