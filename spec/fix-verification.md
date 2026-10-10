# Fix verification protocol (spec v0.1)

Status: draft for comments. It describes how an error tracker decides, without a person, whether
a fix worked in production. Checkend implements it.

The key words MUST, MUST NOT, SHOULD and MAY are used as in RFC 2119.

## 1. States

```
unresolved / regressed --link a fix--> fix_pending --deployed + quiet period--> verified
                                            |                                      |
                                            +------ the error comes back ----------+--> regressed
                                                    in a release with the fix
```

| State | Meaning |
|---|---|
| `fix_pending` | A fix is linked. It is not deployed yet, or its quiet period is not over. |
| `verified` | A deploy contained the fix, and the error did not come back for the quiet period. |
| `regressed` | The error came back in a release that contains the fix. |

## 2. Messages

### Link a fix

An agent or a person links a fix to an issue: a commit SHA (7 to 40 hex characters; a short SHA
matches a full SHA with the same start) or a pull request URL. The issue becomes `fix_pending`.

- A new link replaces the open fix of the issue.
- When a reported deploy already contains the fix, the fix counts as deployed at once.
- When the project has a repository, a tracker SHOULD accept only pull requests of that repository.

### Report a deploy

CI (or a source host such as GitHub) reports each deploy: the project, the deployed commit, the
release name (default: the commit SHA), the environment (default: `production`), and what the
deploy contains: the commits since the previous deploy, and pull requests.

A deploy **contains a fix** when the fix commit is the deployed commit or is in its commits, or
when the fix pull request is in its pull requests (also through the merge commit).

The release name in a deploy report MUST be the same as the release that the SDK sends with each
event. Otherwise the tracker cannot place events.

### Events

Each event carries the release name of the code that sent it.

## 3. Rules

1. **A release contains the fix** when one of its deploys is in the same environment as a deploy
   that contains the fix, and at or after it. So later releases contain the fix too, and so does a
   revert or a rollback deploy after the fix: when the error comes back then, the fix is not in
   production any more.
2. **Regression.** A new event of a `fix_pending` or `verified` issue, in a release that contains
   the fix, makes the issue `regressed`. Events of older releases MUST NOT regress the issue: old
   servers can still run during a rollout.
3. **Quiet period.** A deployed fix becomes `verified` when, for the quiet period (Checkend: 24
   hours by default), the issue had no event that can come from code with the fix. The period
   starts at the deploy, or at the last event when that is later. An event that the tracker cannot
   place in an older release (no release, or a release without a reported deploy) MUST start the
   period again.
4. A tracker checks the quiet periods on a schedule (Checkend: every 5 minutes).
5. **Duplicates.** An event that the tracker already stored (the same event ID) MUST NOT change a
   state. Deploy reports and fix links SHOULD be idempotent where the transport retries.

## 4. Outcomes

For each fix, a tracker SHOULD keep its outcome for later analysis: `verified` or `regressed`, the
time from the link and from the first event of the issue to verification, and who linked the fix
(for example which agent). A fix that was verified and then regressed keeps its verification time.

## 5. Notifications

A tracker MAY notify other systems when an issue is new, regressed or verified (for example a
webhook with the [Agent Issue Brief](agent-issue-brief.md)). Notifications that start agents
SHOULD skip low-trust issues by default, and SHOULD be signed.

## 6. Reference implementation

Checkend: `src/core/fixes.ts` (links, deploys, regression, verification) and
`src/core/github.ts` (deploys and commits from GitHub). The behaviour is tested in
`test/node/fix-loop.test.ts`, and on D1 through the scheduled Worker in
`test/workers/fix-loop.test.ts`.
