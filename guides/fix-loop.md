# Verify fixes

Checkend checks in production that a fix worked. An agent links its fix to the issue, your CI
reports each deploy, and Checkend watches the error. When the error stops after the fix is
deployed, the issue is verified. When the error comes back in a release that contains the fix,
the issue is regressed.

The protocol is an open spec: [Fix verification](../spec/fix-verification.md).

## How it works

An issue goes through these statuses:

1. **`unresolved`** (or `regressed`): the error happens.
2. **`fix_pending`**: an agent or a person links a fix (a commit or a pull request).
3. A deploy contains the fix. The quiet period starts. The status stays `fix_pending`.
4. **`verified`**: the issue had no event for the quiet period (24 hours by default).
5. **`regressed`**: the error came back in a release that contains the fix.

> **Caution:** Checkend can verify a fix only when it knows which release each event comes
> from. Send the release in your Sentry SDK (the `release` option of `Sentry.init`), and report
> each deploy. An event without a release, or with a release that has no reported deploy,
> starts the quiet period again.

## 1. Link the fix

With MCP, the agent calls `link_fix` with `issue_id` and a `commit` or a `pr_url`. With the API:

```sh
curl -X POST "$CHECKEND_URL/v1/issues/42/fix" \
  -H "Authorization: Bearer $CHECKEND_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"commit": "a1b2c3d4e5f6"}'
```

The body has exactly one of these fields:

- `commit`: a commit SHA, 7 to 40 hex characters. A short SHA matches the full SHA.
- `pr_url`: a GitHub pull request URL, `https://github.com/<owner>/<repo>/pull/<number>`.
  When the project has a [repository](#set-the-repository-of-the-project), the pull request must
  be in that repository.

The token needs the `issues:write` scope. The status becomes `fix_pending`. A new link replaces
the open fix. When a deploy with this commit or pull request was already reported, the fix
counts as deployed at once. See [`POST /v1/issues/:id/fix`](api.md#post-v1issuesidfix).

## 2. Report deploys

After each deploy, your CI sends `POST /v1/deploys` with a token that has the `releases:write`
scope:

```sh
# The commits since the last deploy, as a JSON list.
COMMITS=$(git rev-list "$PREVIOUS_DEPLOY_SHA..HEAD" | jq -R . | jq -s -c .)

curl -X POST "$CHECKEND_URL/v1/deploys" \
  -H "Authorization: Bearer $CHECKEND_DEPLOY_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"project\": \"my-app\", \"commit\": \"$(git rev-parse HEAD)\",
       \"release\": \"my-app@1.4.1\", \"environment\": \"production\",
       \"commits\": $COMMITS}"
```

> **Caution:** a fix commit counts as deployed only when it is the deployed `commit`, or when it
> is in `commits` (or its pull request is in `pull_requests`). Without the `commits` list, a fix
> that is not the last commit of the deploy is not found.

Create the deploy token once, in the web UI: **Settings → Tokens** (an owner only). Give it a
name, the scope `releases:write`, and the app. Copy the token: Checkend shows it only once. Add
it to the CI secret `CHECKEND_DEPLOY_TOKEN`. A token for one app reports deploys, uploads
source maps and changes issues only for that app.

On a self-host install, a script can also create it with the admin token:

```sh
curl -X POST "$CHECKEND_URL/v1/tokens" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "ci-deploys", "scopes": ["releases:write"]}'
```

See [`POST /v1/deploys`](api.md#post-v1deploys) for all fields. On GitHub, you can use the
[GitHub webhook](#or-use-the-github-webhook) instead.

### Or use the GitHub webhook

With the GitHub webhook, GitHub tells Checkend about pushes, merged pull requests and
deployments. Then your CI does not need to send the `commits` list.

#### Set the repository of the project

```sh
curl -X PATCH "$CHECKEND_URL/v1/projects/my-app" \
  -H "Authorization: Bearer $CHECKEND_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"repository": "my-org/my-app"}'
```

See [`PATCH /v1/projects/:project`](api.md#patch-v1projectsproject).

#### Connect GitHub

1. Make a random secret, and set it as a Worker secret:

   ```sh
   npx wrangler secret put GITHUB_WEBHOOK_SECRET --config wrangler.<name>.jsonc
   ```

   Without this secret, the webhook endpoint is off (it answers `404`).
2. In GitHub, open the repository settings, then **Webhooks**, and add a webhook:
   - Payload URL: `https://<your-worker>/hooks/github`
   - Content type: `application/json`
   - Secret: the same secret
   - Events: **Pushes**, **Pull requests** and **Deployment statuses**

#### What Checkend does with each event

| GitHub event | What Checkend does |
|---|---|
| A push to a branch | Stores the commits (at most 1000 for each push). A later deploy of a commit contains the commits pushed to the same branch, up to that commit, since the last deploy to the same environment. |
| A pull request that is closed and merged | Stores the merge commit. A deploy that contains the merge commit contains the pull request, so a `pr_url` fix counts as deployed. |
| A deployment status with the state `success` | Records a deploy (`source` is `github`): the commit is `deployment.sha`, the environment is `deployment.environment`, and the release is `deployment.payload.release` when it is a string, else the commit SHA. Other states are ignored. |

> **Caution:** the release of a GitHub deploy must be the same as the release in your SDK. Use
> the commit SHA as the SDK release, or put `release` in the payload of the GitHub deployment.

The repository name selects the projects: all projects with that repository. Other events (for
example `ping`) are ignored. When GitHub sends the same delivery again (the same
`X-GitHub-Delivery` ID, within 7 days), Checkend does nothing. See
[`POST /hooks/github`](api.md#post-hooksgithub) for the responses.

### Suspect commits

When Checkend knows the commits of your deploys, the issue brief can name a **suspect commit**:
a commit of the release where the issue was first seen, which changed the file of an in-app
frame of the issue. The frame where the error was raised counts most. When two commits score the
same, the later commit wins. A changed file matches when its repository path is the end of the
frame path: `src/cart.ts` matches `/srv/app/src/cart.ts`. With [source maps](source-maps.md),
Checkend uses the original file.

> **Note:** a suspect commit is a hint, not proof. It changed a file in the stack trace, but it
> may not be the cause.

The project needs its repository (see [Set the repository of the project](#set-the-repository-of-the-project)).
Checkend gets the commit data in one of two ways:

- **The GitHub webhook** (push events): each pushed commit, with its message, author (the GitHub login),
  time and changed files (at most 300 files and 2,000 characters of message for each commit). No token is
  needed.
- **An optional `GITHUB_TOKEN`** (a Worker secret): a GitHub token that can read the contents of
  the repository. A fine-grained token with **Contents: Read-only** is enough. Then, for each new
  deploy, the cron gets the commits since the previous deploy to the same environment, and the
  changed files of up to 20 of them (the newest). It handles one deploy in each run (every 5
  minutes). If the GitHub API fails, Checkend skips the deploy and logs it.

With `GITHUB_TOKEN`, the commits that Checkend gets also count as contained in the deploy. So a
fix in one of them is marked as deployed, and CI does not need to send `commits`.

The brief shows the suspect commit in its table, for example
`| Suspect commit | a1b2c3d4e5f6 by grace: changed src/cart.ts (frame cartTotal) |`. The commit
message is text from the repository, so the brief shows it in an UNTRUSTED block.

## 3. Send the release in the SDK

Use the same release name in your Sentry SDK and in the deploy report:

```js
Sentry.init({ dsn: "https://<key>@<your-worker>/<project-id>", release: "my-app@1.4.1" });
```

## When a release contains the fix

A release contains the fix when one of its deploys is in the same environment as a deploy with
the fix, and at or after that deploy. So the later releases contain the fix too.

A revert or a rollback deploy after the fix also counts. When the error comes back after it,
the issue becomes `regressed`, because the fix is not in production any more.

## Verification

A Cron Trigger runs every 5 minutes. A deployed fix becomes `verified` when, for the quiet
period, the issue had no event that can come from code with the fix. Events of an older release
(a release with a reported deploy that does not contain the fix) do not count. The quiet period
starts at the deploy (or at the last event, when that is later). The quiet period is `VERIFY_QUIET_HOURS` hours (the default is 24; see
[Settings and health](settings.md)). The activity timeline gets `issue.verify`.

Checkend uses 1 Cron Trigger. The Workers Free plan allows 5 for each account.

## Regression

A new event of a `fix_pending` or `verified` issue, in a release that contains the fix, makes the
issue `regressed`. The fix outcome becomes `regressed`, and the activity timeline gets
`issue.regress`.

Events of older releases do not regress the issue: old servers can still run while a deploy
rolls out. A regressed issue has a higher [priority](api.md#priority-score): the score is
multiplied by 2.

## Fix outcomes

`GET /v1/fix-outcomes` lists the fixes that have an outcome (`verified` or `regressed`), with the
hours from the link to verification, and from the first event of the issue to verification. A team can use it to
see how often fixes work. It needs the `admin` scope. See
[`GET /v1/fix-outcomes`](api.md#get-v1fix-outcomes).
