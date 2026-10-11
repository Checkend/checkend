import { createSetupKey } from "../../core/setup-keys.ts";
import { onboardingProgress } from "../../core/setup-progress.ts";
import type { Actor } from "../../core/tokens.ts";
import { sql } from "../../ports/db.ts";
import type { Ports } from "../../ports/index.ts";
import { ago } from "./html.ts";
import { displayText } from "./text.ts";

/**
 * Agent-first onboarding (D20). The UI makes a setup key for each "Copy prompt", shows the
 * live progress of each app, and deletes apps. The core functions come from the server side;
 * `interimOnboarding` stands in until they exist, and tests pass a fake.
 */

export interface AppProgress {
	project: { id: number; slug: string; name: string; platform: string | null; demo: boolean };
	connected_at: string;
	sdk_installed_at: string | null;
	/** The test event that `ce setup` sends. */
	test_event_at: string | null;
	/** The first real event. */
	first_event_at: string | null;
	/** The first MCP call of a token that a setup key made for this app. */
	agent: { name: string | null; at: string } | null;
	first_deploy_at: string | null;
}

export interface Progress {
	apps: AppProgress[];
	setup_keys_active: number;
}

export type DeleteResult = "deleted" | "not_found" | "approval_required" | "unavailable";

export interface Onboarding {
	/** A new setup key (valid 1 hour). Null: this install cannot make setup keys yet. */
	createSetupKey(ports: Ports, actor: Actor): Promise<{ key: string; expires_at: string } | null>;
	progress(ports: Ports, now: Date): Promise<Progress>;
	deleteProject(ports: Ports, actor: Actor, publicId: number): Promise<DeleteResult>;
}

/** Until the server parts exist: progress from the facts in the database; no keys, no delete. */
export const interimOnboarding: Onboarding = {
	createSetupKey: async () => null,
	progress: async ({ db }) => {
		const rows = await db.all<{
			id: number;
			slug: string;
			name: string;
			platform: string | null;
			created_at: string;
			first_event_at: string | null;
		}>(
			sql`SELECT p.public_id AS id, p.slug, p.name, p.platform, p.created_at,
					(SELECT MIN(i.first_seen) FROM issues i WHERE i.project_id = p.id) AS first_event_at
				FROM projects p ORDER BY p.id`,
		);
		return {
			apps: rows.map((r) => ({
				project: { id: r.id, slug: r.slug, name: r.name, platform: r.platform, demo: false },
				connected_at: r.created_at,
				sdk_installed_at: null,
				test_event_at: null,
				first_event_at: r.first_event_at,
				agent: null,
				first_deploy_at: null,
			})),
			setup_keys_active: 0,
		};
	},
	deleteProject: async () => "unavailable",
};

/** The server parts of D20. Delete comes with the core delete step. */
export const coreOnboarding: Onboarding = {
	createSetupKey: async (ports, actor) => {
		const created = await createSetupKey(ports, actor);
		return { key: created.key, expires_at: created.expires_at };
	},
	progress: (ports, now) => onboardingProgress(ports.db, now),
	deleteProject: async () => "unavailable",
};

export const PLATFORM_LABELS: Record<string, string> = {
	node: "Node.js",
	javascript: "Browser JavaScript",
	python: "Python",
	ruby: "Ruby",
	php: "PHP",
	go: "Go",
	other: "Other",
};
export const platformLabel = (platform: string | null): string =>
	platform ? (PLATFORM_LABELS[platform] ?? displayText(platform, 32)) : "Platform not set";

export interface Step {
	key: "connected" | "sdk" | "test_event" | "agent" | "deploys";
	label: string;
	done: boolean;
	detail: string;
}

/** The checklist of one app. The texts are plain strings: the client sets them as text. */
export function stepsFor(app: AppProgress, now: Date): Step[] {
	const errorAt = app.test_event_at ?? app.first_event_at;
	const platform = app.project.platform ? ` · ${platformLabel(app.project.platform)}` : "";
	return [
		{
			key: "connected",
			label: "App connected",
			done: true,
			detail: `${displayText(app.project.name, 60)}${platform}`,
		},
		{
			key: "sdk",
			label: "SDK installed",
			done: app.sdk_installed_at !== null,
			detail: app.sdk_installed_at ? "reported by the agent" : "waiting for the agent",
		},
		{
			key: "test_event",
			label: "Test error received",
			done: errorAt !== null,
			detail: errorAt ? ago(errorAt, now) : "waiting for the first error",
		},
		{
			key: "agent",
			label: "Agent connected (MCP)",
			done: app.agent !== null,
			detail: app.agent
				? displayText(app.agent.name ?? "connected", 40)
				: "waiting for the first MCP call",
		},
		{
			key: "deploys",
			label: "Deploys reported",
			done: app.first_deploy_at !== null,
			detail: app.first_deploy_at ? ago(app.first_deploy_at, now) : "waiting for the next CI run",
		},
	];
}

export const isComplete = (app: AppProgress, now: Date): boolean =>
	stepsFor(app, now).every((s) => s.done);

/** The progress as the page polls it: one entry per app, the demo app left out. */
export function progressJson(progress: Progress, now: Date) {
	const apps = progress.apps
		.filter((a) => !a.project.demo)
		.map((a) => {
			const steps = stepsFor(a, now);
			return {
				id: a.project.id,
				name: displayText(a.project.name, 100),
				complete: steps.every((s) => s.done),
				done: steps.filter((s) => s.done).length,
				steps,
			};
		});
	return {
		apps,
		waiting: apps.length === 0 && progress.setup_keys_active > 0,
		all_complete: apps.length > 0 && apps.every((a) => a.complete),
	};
}
export type ProgressJson = ReturnType<typeof progressJson>;

/** The first prompt: the user pastes it into their coding agent, in the app's repository. */
export function setupPrompt(origin: string, key: string): string {
	return `Set up Checkend error tracking for this app.
1. If \`ce\` is not installed, install it: ${origin}/agent/install
2. Run: ce setup --url ${origin} --key ${key}   (the key is valid for 1 hour)
3. Follow the steps that \`ce setup\` prints.`;
}

/** The placeholder before the first copy: a real key is made on each "Copy prompt". */
export const KEY_PLACEHOLDER = "cks_…";

export interface AgentTask {
	task: string;
	label: string;
	/** For people: what the task gives them. */
	description: string;
	/** For the agent: what to do, after "For the Checkend app <slug>, ". */
	action: string;
	command: string | null;
}

/** The "Ask your agent" tasks. Each names a recipe that this install serves. */
export const AGENT_TASKS: AgentTask[] = [
	{
		task: "sourcemaps",
		label: "Add source maps",
		description: "Readable JavaScript stack traces, with the original file and line.",
		action: "upload the source maps of each build",
		command: "ce sourcemaps upload",
	},
	{
		task: "deploys",
		label: "Report deploys",
		description: "See which deploy caused an error, and which one fixed it.",
		action: "report each deploy from CI",
		command: "ce deploy",
	},
	{
		task: "environments",
		label: "Add environments",
		description: "Keep errors from staging apart from production.",
		action: "set the environment in the SDK configuration",
		command: null,
	},
	{
		task: "migrate-from-sentry",
		label: "Move from Sentry",
		description: "Replace the Sentry settings in the code with Checkend.",
		action: "move the error tracking from Sentry to Checkend",
		command: "ce migrate-from-sentry",
	},
	{
		task: "fix-top-issue",
		label: "Fix the top error",
		description: "The agent reads the brief of the top error, fixes it, and links the fix.",
		action: "fix the error with the highest priority",
		command: null,
	},
	{
		task: "rotate-dsn",
		label: "Replace the app key",
		description: "Make a new key for the app, for example after it was in a public place.",
		action: "replace the app key (DSN) in the code and in the deploy settings",
		command: "ce dsn rotate",
	},
	{
		task: "remove",
		label: "Remove Checkend from the code",
		description: "Remove the SDK and the settings from this app.",
		action: "remove the Checkend SDK and its settings from the code",
		command: "ce remove",
	},
	{
		task: "delete-project",
		label: "Delete the app in Checkend",
		description: "Delete the app and all its errors. You confirm it.",
		action: "delete the app in Checkend, after you ask me to confirm",
		command: "ce project delete",
	},
];

/**
 * The prompt of one task. The app is named by its slug and public ID only: the name is free
 * text, and a prompt must not carry text that an agent could read as an instruction.
 */
export function taskPrompt(
	origin: string,
	app: { id: number; slug: string },
	task: AgentTask,
): string {
	const command = task.command ? ` Use \`${task.command}\`.` : "";
	return `For the Checkend app ${app.slug} (ID ${app.id}), ${task.action}. Read ${origin}/agent/tasks/${task.task}.md and follow it.${command}`;
}
