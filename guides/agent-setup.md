# Set up with an agent

A coding agent can set up Checkend in your apps for you: register each app, add the SDK, send a
test event, and connect itself with MCP. You give it a short-lived **setup key**, and you can
follow its progress.

## 1. Make a setup key

In the [web UI](web-ui.md#3-connect-your-apps), **Copy prompt** makes a setup key and a prompt
for the agent. Or use the API:

```sh
curl -X POST "$CHECKEND_URL/v1/setup/keys" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN"
```

A setup key (`cks_...`):

- lasts 1 hour
- works only on `/v1/setup/*`; on every other route it gets `401`
- can register at most 10 apps and make at most 5 agent tokens, also with parallel requests;
  above that, the answer is `429` `{"error": "limit"}`
- can be revoked with `DELETE /v1/setup/keys/:id`; this also revokes the agent tokens that it made

Checkend stores only a hash of the key. `GET /v1/setup/keys` lists the keys.

## 2. Give the agent the recipe

Tell the agent to read `https://<your-worker>/agent/install`, and give it the setup key. The
recipes are public: they need no token and contain no secrets.

| Path | What it is |
|---|---|
| `/agent/install` | Where the agent starts. |
| `/agent/setup.md` | The setup steps. |
| `/agent/tasks/<task>.md` | Recipes for later tasks: `sourcemaps`, `deploys`, `migrate-from-sentry`, `environments`, `rotate-dsn`, `fix-top-issue`, `delete-project` and `remove`. |

## 3. What the agent does

With the setup key (or an admin token), the agent:

1. Registers each app: `POST /v1/setup/apps` with `{"name": "...", "platform": "..."}`. It gets
   the project and its DSN (`201`). A retry with the same name returns the same app (`200`).
2. Makes an agent token for the app: `POST /v1/setup/tokens` with `{"name": "...", "project": ...}`.
   The token has `issues:read` and `issues:write`.
3. Adds the SDK with the DSN, and reports it:
   `POST /v1/setup/apps/:project/report` with `{"step": "sdk_installed"}`.
4. Sends one test event: `POST /v1/setup/apps/:project/test-event` (`202`). The event has the
   tag `checkend.test=true`. A second test event gives `409`.
5. Connects itself with [MCP](mcp.md), with the agent token (see [Connect the agent](#connect-the-agent)).

The test event makes a **test issue**. It is created resolved, and it does not count: it sends no
alerts or webhooks, it adds nothing to the counts, the priority, the quotas or `last_event_at`,
and it gets no AI triage. The issue list leaves it out (`GET /v1/issues?test=true` lists the test
issues), and its brief has a row "Test event from setup: not a real error".

### Connect the agent

The recipe connects the agent through `ce mcp`: a local MCP server that keeps the agent token in
the keychain of the operating system, so the token never goes into a config file of the agent.
Install `ce` (see [Install ce](cli.md#install-ce) for npm, Homebrew and `go install`):

```sh
curl -fsSL https://raw.githubusercontent.com/Checkend/checkend-cli/main/install.sh | sh
```

Then, for Claude Code:

```sh
claude mcp add checkend -- ce mcp --url https://<your-worker>
```

The agent starts `ce` by its name. If you used `go install`: it puts `ce` in `$(go env GOPATH)/bin` (or
`$(go env GOBIN)`), which is often not on PATH. If `ce --version` fails, use the full path:

```sh
claude mcp add checkend -- "$(go env GOPATH)/bin/ce" mcp --url https://<your-worker>
```

Or add the folder to PATH in `~/.zshrc` or `~/.bashrc`:
`export PATH="$PATH:$(go env GOPATH)/bin"`.

Without `ce`, the recipe uses the fallback: HTTP MCP with the agent token in an environment
variable (see [Connect](mcp.md#connect)). The recipes take keys and tokens only from environment
variables (`CHECKEND_SETUP_KEY`, `CHECKEND_TOKEN`, `CHECKEND_DEPLOY_TOKEN`,
`CHECKEND_ADMIN_TOKEN`).

> **Caution:** an agent token reads the issues of every project of the install, not only of its
> own app. It changes only the issues of its own app (another app gives `403`
> `forbidden_project`). It does not expire.

The agent token stops working when you revoke its setup key (`DELETE /v1/setup/keys/:id`), when
you delete its project, or when you revoke it (`DELETE /v1/tokens/:id`). Each revoked token gets a
`token.revoke` activity row.

The agent token that the setup made can also report the steps of its own app, also after the
setup key expires. For any other app, it gets `403`.

## 4. Follow the progress

`GET /v1/setup/progress` (with the setup key or an admin token) shows for each app:

| Field | Meaning |
|---|---|
| `connected_at` | The app was registered. |
| `sdk_installed_at` | The agent reported the SDK. |
| `test_event_at` | The test event arrived. |
| `first_event_at` | The first real event arrived (not the test event). |
| `agent` | `{name, at}`: the first MCP call with the agent token, and the name of the MCP client. |
| `first_deploy_at` | The first reported deploy. |

It also shows `setup_keys_active`. A setup key sees only its own apps.

See [Setup](api.md#setup) in the API reference for all responses.
