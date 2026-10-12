import { UNTRUSTED_NOTICE } from "./brief.ts";

/**
 * Recipes that this instance serves to coding agents (onboarding): /agent/install,
 * /agent/setup.md and /agent/tasks/<task>.md. They are generated from the instance URL and
 * contain no secrets: the setup key stays in the prompt that the user pastes, and every command
 * reads keys and tokens from environment variables. `ce` (the Checkend CLI) is the main path;
 * each recipe also has a fallback without it (curl and HTTP MCP). The UI's "Ask your agent" menu
 * uses AGENT_TASKS for its prompts.
 */

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
		command: null,
		summary: "Remove the SDK setup and the CI steps of Checkend from this repository.",
	},
];

/** The fallback HTTP calls: the key or token always comes from an environment variable. */
const curl = (method: string, url: string, token: string, body?: string) =>
	`curl -X ${method} "${url}" -H "Authorization: Bearer $${token}"${
		body ? ` \\\n  -H "Content-Type: application/json" -d '${body}'` : ""
	}`;

/** /agent/install: how to get `ce`, truthfully, and what to do without it. */
export function installRecipe(base: string): string {
	return `# Install ce (the Checkend CLI)

\`ce\` connects this repository to the Checkend instance at ${base}.

## Check first

Run \`ce --version\`. If it works, \`ce\` is installed: go to ${base}/agent/setup.md.

## Get ce

Today, install \`ce\` with Go (Go 1.26 or later):

\`\`\`sh
go install github.com/Checkend/checkend-cli/cmd/ce@latest
\`\`\`

Then run \`ce --version\`. If the shell does not find \`ce\`, the Go bin folder is not on PATH
(\`go install\` writes to \`$(go env GOBIN)\` when it is set, else to \`$(go env GOPATH)/bin\`). For
this session, run \`"$(go env GOPATH)/bin/ce"\` in place of \`ce\`. Tell the person to add this line
to \`~/.zshrc\` (zsh) or \`~/.bashrc\` (bash), then open a new terminal:

\`\`\`sh
export PATH="$PATH:$(go env GOPATH)/bin"
\`\`\`

Release builds (Homebrew, an install script, an npm package) are not available yet.

Without Go, use the steps under "If ce is not available" in ${base}/agent/setup.md. They do the
same work with curl.

## Rules

- The setup key is in the prompt of the user. Pass it to \`ce\` only in the environment variable \`CHECKEND_SETUP_KEY\`: never as an argument (\`--key\`), and never in a file, a commit or a log.
- \`ce\` keeps its credentials in the OS keychain. Do not copy them into the repository.
`;
}

/** /agent/setup.md: the steps that `ce setup` prints and the agent follows. */
export function setupRecipe(base: string): string {
	return `# Set up Checkend error tracking

Checkend (${base}) receives errors from Sentry SDKs ("Sentry SDK compatible"). Do these steps in the
repository of the app. Make all code changes in one commit or pull request, for a human to review.

## 1. Run ce setup

Put the setup key from your prompt into the environment variable \`CHECKEND_SETUP_KEY\` (not into
the command line), then run:

\`\`\`sh
ce setup --url ${base}
\`\`\`

\`ce setup\` registers the app, gets its DSN, stores the credentials in the OS keychain, sends a test
event, and connects MCP. It prints the DSN and the next steps. The setup key is valid for 1 hour.
Without \`ce\`: see "If ce is not available" at the end.

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

The agent starts \`ce\` by its name, so \`ce\` must be on PATH. If \`ce --version\` fails because
\`go install\` put \`ce\` in a folder that is not on PATH, use its full path. The shell writes the
full path into the agent config:

- Claude Code: \`claude mcp add checkend -- "$(go env GOPATH)/bin/ce" mcp --url ${base}\`
- Codex: \`codex mcp add checkend -- "$(go env GOPATH)/bin/ce" mcp --url ${base}\`
- Cursor: put the output of \`echo "$(go env GOPATH)/bin/ce"\` in \`"command"\`.

Then agents read issues with the tools list_issues and get_issue_brief.

## 8. Report deploys in CI

Add a deploy step to CI: ${base}/agent/tasks/deploys.md.

## 9. Browser builds: upload source maps

If the app has a browser build: ${base}/agent/tasks/sourcemaps.md.

## 10. Add the Checkend skill

Add ${base}/skill.md to the agent skills of this repository (for example \`.claude/skills/checkend/SKILL.md\`).

## 11. Commit

Make one commit or pull request with all the changes. Describe what you changed and which settings
the human must set (the DSN variable, the CI secret).

## If ce is not available (fallback)

Do the work of \`ce setup\` with curl. The setup key stays in \`CHECKEND_SETUP_KEY\`; never put a key
or a token into a command line, a file or a commit.

1. Register the app (the platform is a Sentry platform name, for example \`node-express\`). The
   answer has the DSN:

   \`\`\`sh
   ${curl("POST", `${base}/v1/setup/apps`, "CHECKEND_SETUP_KEY", '{"name": "<app name>", "platform": "<platform>"}')}
   \`\`\`

2. Make an agent token for the app. Ask the human to keep the token in a secret store and to set it
   as the environment variable \`CHECKEND_TOKEN\` for your agent. Do not write it anywhere yourself.

   \`\`\`sh
   ${curl("POST", `${base}/v1/setup/tokens`, "CHECKEND_SETUP_KEY", '{"name": "<agent name>", "project": "<app slug>"}')}
   \`\`\`

3. Send the test event, and report the SDK install (after steps 3 to 6):

   \`\`\`sh
   ${curl("POST", `${base}/v1/setup/apps/<app slug>/test-event`, "CHECKEND_SETUP_KEY")}
   ${curl("POST", `${base}/v1/setup/apps/<app slug>/report`, "CHECKEND_TOKEN", '{"step": "sdk_installed"}')}
   \`\`\`

4. Connect MCP over HTTP: the server ${base}/mcp with the header
   \`Authorization: Bearer \${CHECKEND_TOKEN}\`. Use the environment variable expansion of your agent
   config, so that the file holds \`\${CHECKEND_TOKEN}\` and not the token.

## Rules

- Never put a token, a setup key or a DSN in the repository. Use environment variables and CI secrets.
- ${UNTRUSTED_NOTICE}
`;
}

const TASKS: Record<string, (base: string) => string> = {
	sourcemaps: (base) => `## Steps

1. Find the build output with the .map files (for example dist/ or build/). Make the build produce
   source maps if it does not.
2. Add a CI step after the build:

   \`\`\`sh
   ce sourcemaps upload --release "$RELEASE" dist/
   \`\`\`

3. \`release\` must be the same value as the release of the SDK.
4. The CI needs a token in the secret CHECKEND_DEPLOY_TOKEN. Ask the human to create a token with releases:write for this app in Settings → Tokens, and to add it to the CI secret CHECKEND_DEPLOY_TOKEN.
   Do not create it yourself.
5. Do not deploy the .map files to the public web server unless the app already does.

## If ce is not available

For each .map file, POST ${base}/v1/sourcemaps?project=<app>&release=<release>&name=<minified file URL path>
with the map as the body:

\`\`\`sh
${curl("POST", `${base}/v1/sourcemaps?project=<app>&release=$RELEASE&name=~/static/app.min.js`, "CHECKEND_DEPLOY_TOKEN")} \\
  -H "Content-Type: application/json" --data-binary @dist/static/app.min.js.map
\`\`\`
`,
	deploys: (base) => `## Steps

1. Add a CI step after a successful deploy:

   \`\`\`sh
   ce deploy --release "$RELEASE" --environment production --commits-since "$PREVIOUS_DEPLOY_SHA"
   \`\`\`

   The commit is git HEAD by default. \`--commits-since\` adds the commits since the last deploy, so
   that Checkend can find suspect commits and verify fixes.
2. The CI needs a token in the secret CHECKEND_DEPLOY_TOKEN. Ask the human to create a token with releases:write for this app in Settings → Tokens, and to add it to the CI secret CHECKEND_DEPLOY_TOKEN.
   Do not create it yourself.

## If ce is not available

POST ${base}/v1/deploys with the commit, and \`"commits"\`: the output of
\`git rev-list <previous>..HEAD\`:

\`\`\`sh
${curl("POST", `${base}/v1/deploys`, "CHECKEND_DEPLOY_TOKEN", '{"project": "<app>", "commit": "<sha>", "release": "<release>", "environment": "production"}')}
\`\`\`
`,
	"migrate-from-sentry": (base) => `## Steps

1. Find the Sentry DSN in the configuration of the app (often \`SENTRY_DSN\`).
2. Run \`ce migrate-from-sentry\`. It registers the app in Checkend, prints the new DSN and the files
   and lines to change. It changes no code.
3. Replace the Sentry DSN with the Checkend DSN in the environment configuration. Keep the Sentry SDK:
   Checkend is Sentry SDK compatible.
4. Remove Sentry-only options that Checkend does not use (performance tracing, session replay,
   profiling), or leave them: Checkend keeps error events only.
5. Move the CI steps (source map upload, release reports) to Checkend: see sourcemaps.md and deploys.md.

## If ce is not available

Register the app with a setup key from the human (in \`CHECKEND_SETUP_KEY\`); the answer has the DSN:

\`\`\`sh
${curl("POST", `${base}/v1/setup/apps`, "CHECKEND_SETUP_KEY", '{"name": "<app name>", "platform": "<platform>"}')}
\`\`\`
`,
	environments: () => `## Steps

1. Set \`environment\` in the SDK initialization from an environment variable (for example
   \`SENTRY_ENVIRONMENT\`), with one value for each deployment: production, staging, development.
2. Set the variable in each deployment configuration.
3. Report deploys with the same environment name (\`ce deploy --environment <name>\`).
`,
	"rotate-dsn": (base) => `## Steps

1. Run \`ce dsn rotate\`. It makes a new DSN key and prints the new DSN. The old key still works.
2. Put the new DSN in the environment configuration of every deployment, and deploy.
3. When all deployments use the new DSN, ask the human to confirm, then revoke the old keys:
   \`ce dsn rotate --revoke-old --yes\`. Events with an old key then get 401 (within a minute).

## If ce is not available

These need an admin token, which only the human holds (in \`CHECKEND_ADMIN_TOKEN\`):

\`\`\`sh
${curl("POST", `${base}/v1/projects/<app>/keys`, "CHECKEND_ADMIN_TOKEN")}
${curl("DELETE", `${base}/v1/projects/<app>/keys/<old-key>`, "CHECKEND_ADMIN_TOKEN")}
\`\`\`
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
	"delete-project": (base) => `## Steps

> **Warning:** this deletes the app and all its issues and events in Checkend. It cannot be undone.

1. Ask the human to confirm the name of the app. Do not delete without a confirmation in this session.
2. Then run \`ce project delete <app> --yes\`. It needs an admin token.
3. The DSN keys stop (events get 401 within a minute). Remove the Checkend setup from the code: see
   remove.md.

## If ce is not available

The human runs it with the admin token (in \`CHECKEND_ADMIN_TOKEN\`):

\`\`\`sh
${curl("DELETE", `${base}/v1/projects/<app>`, "CHECKEND_ADMIN_TOKEN")}
\`\`\`
`,
	remove: () => `## Steps

1. Find the Checkend parts in this repository: the Sentry SDK initialization with the Checkend DSN,
   the DSN variable, the deploy and source map CI steps, and the Checkend skill.
2. Remove them (keep the Sentry SDK if the app also uses Sentry).
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
