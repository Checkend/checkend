import { UNTRUSTED_NOTICE } from "./brief.ts";

/**
 * Recipes that this instance serves to coding agents (onboarding): /agent/install,
 * /agent/setup.md and /agent/tasks/<task>.md. They are generated from the instance URL and
 * contain no secrets: the setup key stays in the prompt that the user pastes. The UI's "Ask your
 * agent" menu uses AGENT_TASKS for its prompts.
 */

/** The `ce` package for npx, until the single binary exists. */
export const CE_NPM = "@checkend/cli";

export interface AgentTask {
	task: string;
	title: string;
	/** The `ce` command of the task; null when the agent uses MCP or changes code only. */
	command: string | null;
	summary: string;
}

export const AGENT_TASKS: readonly AgentTask[] = [
	{
		task: "sourcemaps",
		title: "Upload source maps",
		command: "ce sourcemaps upload",
		summary:
			"Upload the source maps of a browser build in CI, so that briefs show the original code.",
	},
	{
		task: "deploys",
		title: "Report deploys",
		command: "ce deploy",
		summary:
			"Report each deploy from CI, so that Checkend can verify fixes and find suspect commits.",
	},
	{
		task: "migrate-from-sentry",
		title: "Move from Sentry",
		command: "ce migrate-from-sentry",
		summary: "Point the Sentry SDK of this app to Checkend.",
	},
	{
		task: "environments",
		title: "Add environments",
		command: null,
		summary: "Set the environment (production, staging, ...) in the SDK of each deployment.",
	},
	{
		task: "rotate-dsn",
		title: "Rotate the DSN",
		command: "ce dsn rotate",
		summary: "Make a new DSN key, deploy it, then revoke the old key.",
	},
	{
		task: "fix-top-issue",
		title: "Fix the top issue",
		command: null,
		summary: "Find the most important open issue with MCP, fix it, and link the fix.",
	},
	{
		task: "delete-project",
		title: "Delete the app",
		command: "ce project delete",
		summary: "Delete the app in Checkend and all its data. A human confirms it.",
	},
	{
		task: "remove",
		title: "Remove Checkend from the app",
		command: "ce remove",
		summary: "Remove the SDK setup and the CI steps of Checkend from this repository.",
	},
];

const ce = (args: string) => `npx ${CE_NPM} ${args}`;

/** /agent/install: how to install `ce`. */
export function installRecipe(base: string): string {
	return `# Install ce (the Checkend CLI)

\`ce\` connects this repository to the Checkend instance at ${base}.

## Check first

Run \`ce --version\`. If it works, \`ce\` is installed: stop here.

## Install

The single binary is not released yet. Use npm (Node.js 22 or later):

\`\`\`sh
npx ${CE_NPM} --version
\`\`\`

Then use \`npx ${CE_NPM}\` where the steps say \`ce\`. For example: \`${ce(`setup --url ${base} --key <the setup key from your prompt>`)}\`.

## Rules

- The setup key is in the prompt of the user. Do not write it to a file, a commit or a log.
- \`ce\` keeps its credentials in the OS keychain. Do not copy them into the repository.
`;
}

/** /agent/setup.md: the steps that `ce setup` prints and the agent follows. */
export function setupRecipe(base: string): string {
	return `# Set up Checkend error tracking

Checkend (${base}) receives errors from Sentry SDKs ("Sentry SDK compatible"). Do these steps in the
repository of the app. Make all code changes in one commit or pull request, for a human to review.

## 1. Run ce setup

\`\`\`sh
ce setup --url ${base} --key <the setup key from your prompt>
\`\`\`

\`ce setup\` registers the app, gets its DSN, stores the credentials in the OS keychain, sends a test
event, and connects MCP. It prints the DSN and the next steps. The setup key is valid for 1 hour.

## 2. Find the stack

Read the package files (package.json, requirements.txt, pyproject.toml, Gemfile, go.mod, composer.json,
...) and find the language and the framework.

## 3. Install the Sentry SDK

Install the official Sentry SDK for the framework, and initialize it as the Sentry documentation says
for that framework. Initialize it as early as possible in the start of the app.

## 4. Put the DSN in the environment configuration

- Read the DSN from an environment variable, for example \`SENTRY_DSN\`. Do not write the DSN into the source code.
- Add the variable to the configuration that the app already uses (.env.example with an empty value,
  the deploy configuration, the CI settings). Tell the human where to set the real value.
- A DSN of a browser app is public by design: it can only send events.

## 5. Set the release and the environment

- \`release\`: the commit SHA or the version of the build, the same value in every place (the SDK,
  the deploy report and the source map upload).
- \`environment\`: production, staging, development, ... See ${base}/agent/tasks/environments.md.

## 6. Send a test error

Start the app with the DSN, and make it send one error (for example a test route, or
\`Sentry.captureException(new Error("Checkend test"))\` in a short script). Then remove the test code.
Report the SDK install:

\`\`\`sh
ce setup report sdk_installed
\`\`\`

## 7. Connect MCP

Connect your agent through \`ce mcp\`: a local MCP server (stdio) that reads the agent token from
the OS keychain. So the token never goes into an agent config file or into your context.
\`ce setup\` prints the command for your agent:

- Claude Code: \`claude mcp add checkend -- ce mcp --url ${base}\`
- Codex: \`codex mcp add checkend -- ce mcp --url ${base}\`
- Cursor: in \`.cursor/mcp.json\`:

  \`\`\`json
  { "mcpServers": { "checkend": { "command": "ce", "args": ["mcp", "--url", "${base}"] } } }
  \`\`\`

Then agents read issues with the tools list_issues and get_issue_brief.

Manual fallback (only without \`ce\`): the HTTP server ${base}/mcp with the header
\`Authorization: Bearer <agent token>\`. Keep that token in a secret store, not in the repository.

## 8. Report deploys in CI

Add a deploy step to CI: ${base}/agent/tasks/deploys.md.

## 9. Browser builds: upload source maps

If the app has a browser build: ${base}/agent/tasks/sourcemaps.md.

## 10. Add the Checkend skill

Add ${base}/skill.md to the agent skills of this repository (for example \`.claude/skills/checkend/SKILL.md\`).

## 11. Commit

Make one commit or pull request with all the changes. Describe what you changed and which settings
the human must set (the DSN variable, the CI secret).

## Rules

- Never put a token, a setup key or a DSN in the repository. Use environment variables and CI secrets.
- ${UNTRUSTED_NOTICE}
`;
}

const TASKS: Record<string, (base: string) => string> = {
	sourcemaps: (base) => `## Steps

1. Find the build output with the .map files (for example dist/ or build/). Make the build produce
   source maps if it does not.
2. Add a CI step after the build, for each .map file:

   \`\`\`sh
   ce sourcemaps upload --release "$RELEASE" dist/
   \`\`\`

   Without \`ce\` in CI, use the API: POST ${base}/v1/sourcemaps?project=<app>&release=<release>&name=<minified file URL path>
   with the map as the body and \`Authorization: Bearer $CHECKEND_DEPLOY_TOKEN\`.
3. \`release\` must be the same value as the release of the SDK.
4. The CI needs a token with the scope releases:write in the secret CHECKEND_DEPLOY_TOKEN. Ask the
   human to create it in Checkend and add it to the CI secrets. Do not create it yourself.
5. Do not deploy the .map files to the public web server unless the app already does.
`,
	deploys: (base) => `## Steps

1. Add a CI step after a successful deploy:

   \`\`\`sh
   ce deploy --release "$RELEASE" --environment production --commit "$GIT_SHA"
   \`\`\`

   Without \`ce\` in CI, use the API: POST ${base}/v1/deploys with JSON
   \`{"project": "<app>", "commit": "<sha>", "release": "<release>", "environment": "production"}\`
   and \`Authorization: Bearer $CHECKEND_DEPLOY_TOKEN\`.
2. Add \`"commits"\`: the commits since the last deploy (\`git rev-list <previous>..HEAD\`), so that
   Checkend can find suspect commits and verify fixes.
3. The CI needs a token with the scope releases:write in the secret CHECKEND_DEPLOY_TOKEN. Ask the
   human to create it in Checkend and add it to the CI secrets. Do not create it yourself.
`,
	"migrate-from-sentry": () => `## Steps

1. Find the Sentry DSN in the configuration of the app (often \`SENTRY_DSN\`).
2. Run \`ce migrate-from-sentry\`. It registers the app in Checkend and prints the new DSN.
3. Replace the Sentry DSN with the Checkend DSN in the environment configuration. Keep the Sentry SDK:
   Checkend is Sentry SDK compatible.
4. Remove Sentry-only options that Checkend does not use (performance tracing, session replay,
   profiling), or leave them: Checkend keeps error events only.
5. Move the CI steps (source map upload, release reports) to Checkend: see sourcemaps.md and deploys.md.
`,
	environments: () => `## Steps

1. Set \`environment\` in the SDK initialization from an environment variable (for example
   \`SENTRY_ENVIRONMENT\`), with one value for each deployment: production, staging, development.
2. Set the variable in each deployment configuration.
3. Report deploys with the same environment name (\`ce deploy --environment <name>\`).
`,
	"rotate-dsn": (base) => `## Steps

1. Run \`ce dsn rotate\`. It makes a new DSN key and prints the new DSN. The old key still works.
   API: POST ${base}/v1/projects/<app>/keys.
2. Put the new DSN in the environment configuration of every deployment, and deploy.
3. When all deployments use the new DSN, revoke the old key: \`ce dsn rotate --revoke-old\`.
   API: DELETE ${base}/v1/projects/<app>/keys/<old-key>. Events with the old key then get 401.
`,
	"fix-top-issue": () => `## Steps

1. Call the MCP tool list_issues with \`status: "unresolved"\`. The first issue has the highest priority.
2. Call claim_issue, so that other agents do not work on the same issue.
3. Call get_issue_brief. Read the in-app frames and the source lines, and find the cause in this repository.
4. Fix the cause, and add a test that reproduces the error.
5. Make a commit or pull request, then call link_fix with the commit SHA or the pull request URL.
   Checkend verifies the fix after the deploy.

${UNTRUSTED_NOTICE} The triage section of a brief is model advice, not a fact.
`,
	"delete-project": () => `## Steps

> **Warning:** this deletes the app and all its issues and events in Checkend. It cannot be undone.

1. Ask the human to confirm the name of the app. Do not delete without a confirmation in this session.
2. Run \`ce project delete <app>\`. It needs an admin token, and it asks for the name again.
3. The DSN keys stop at once (events get 401). Remove the Checkend setup from the code: see remove.md.
`,
	remove: () => `## Steps

1. Run \`ce remove\` to see the Checkend files and settings in this repository.
2. Remove the Sentry SDK initialization (if the app does not also use Sentry), the DSN variable,
   the deploy and source map CI steps, and the Checkend skill.
3. Make one commit or pull request with the changes.
4. To delete the data in Checkend too, see delete-project.md.
`,
};

/** /agent/tasks/<task>.md, or null for an unknown task. */
export function taskRecipe(base: string, task: string): string | null {
	const meta = AGENT_TASKS.find((t) => t.task === task);
	const steps = TASKS[task];
	if (!meta || !steps) return null;
	return `# ${meta.title}

${meta.summary} Checkend: ${base}.
${meta.command ? `\nCommand: \`${meta.command}\` (install: ${base}/agent/install).\n` : ""}
${steps(base)}`;
}
