import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as v from "valibot";
import { AUTH_ATTEMPT_WINDOW_MS, allowAuthAttempt } from "../../core/auth/attempts.ts";
import {
	finishSetup,
	finishSignIn,
	isSetupOpen,
	relyingPartyFor,
	setupOptions,
	signInOptions,
} from "../../core/auth/passkeys.ts";
import {
	createDevSession,
	deleteSession,
	SESSION_TTL_MS,
	type Session,
} from "../../core/auth/sessions.ts";
import { checkHealth } from "../../core/health.ts";
import { inboxFacets, issueTags, listInbox } from "../../core/inbox.ts";
import type { IngestState } from "../../core/ingest/state.ts";
import { ingestStatus } from "../../core/ingest-status.ts";
import {
	decodeCursor,
	getEvent,
	getIssue,
	ISSUE_STATUSES,
	type IssueRow,
	listIssueEvents,
	ProjectRef,
} from "../../core/issues.ts";
import { createProject, listProjects } from "../../core/projects.ts";
import { sql } from "../../ports/db.ts";
import type { AppEnv } from "../app.ts";
import { assetRoutes } from "./assets/index.ts";
import { type Html, h } from "./html.ts";
import { appPath, parseEventId, parseIssueId, parseProjectId } from "./ids.ts";
import { page, type Section } from "./layout.ts";
import { type Onboarding, progressJson, setupPrompt } from "./onboarding.ts";
import {
	checkFormCsrf,
	checkJsonCsrf,
	clearedSessionCookie,
	clientIp,
	isDevRequest,
	requireMember,
	securityHeaders,
	sessionCookie,
	sessionToken,
} from "./security.ts";
import { displayText } from "./text.ts";
import {
	type AppPageData,
	type AppRow,
	type AppTab,
	appsView,
	appView,
	homeView,
	newAppView,
	PLATFORMS,
	SDKS,
} from "./views/apps.ts";
import { loginView, notFoundView, setupClosedView, setupView } from "./views/auth.ts";
import { type EventDetail, eventView } from "./views/event.ts";
import { inboxView, issueView, SINCE_CHOICES } from "./views/issues.ts";
import { type MemberRow, settingsView } from "./views/settings.ts";

const SESSION_MAX_AGE = Math.floor(SESSION_TTL_MS / 1000);

/** The web UI: server-rendered HTML, cookie sessions, passkeys. The API stays bearer-only. */
export function uiRoutes(app: Hono<AppEnv>, state: IngestState, onboarding: Onboarding): void {
	assetRoutes(app);

	const render = (
		c: Context<AppEnv>,
		title: string,
		section: Section | undefined,
		body: Html,
		status: ContentfulStatusCode = 200,
	) => {
		const session = c.get("session") as Session | undefined;
		return c.html(
			page({
				title,
				member: session ? { name: session.memberName, devMode: c.env.ports.config.devMode } : null,
				...(section ? { section } : {}),
				body,
			}),
			status,
		);
	};
	const notFound = (c: Context<AppEnv>) => render(c, "Not found", undefined, notFoundView(), 404);
	const now = (c: Context<AppEnv>) => c.env.ports.clock.now();
	const member = [securityHeaders, requireMember] as const;

	// --- sign-in, setup, sign-out -------------------------------------------------------

	app.get("/login", securityHeaders, async (c) => {
		if (await isSetupOpen(c.env.ports.db)) return c.redirect("/setup", 303);
		return c.html(page({ title: "Sign in", body: loginView({ devLogin: isDevRequest(c) }) }));
	});

	/** Sign-in and setup attempts per client IP; answers 429 above the limit. */
	const limited = async (c: Context<AppEnv>) => {
		if (await allowAuthAttempt(c.env.ports, clientIp(c))) return null;
		c.header("Retry-After", String(AUTH_ATTEMPT_WINDOW_MS / 1000));
		return c.json({ error: "rate_limited" }, 429);
	};
	const body = async (c: Context<AppEnv>): Promise<Record<string, unknown>> => {
		const parsed: unknown = await c.req.json().catch(() => null);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	};
	const signedIn = (c: Context<AppEnv>, token: string, redirect: string) => {
		c.header("Set-Cookie", sessionCookie(token, SESSION_MAX_AGE));
		return c.json({ redirect });
	};

	app.post("/login/options", securityHeaders, checkJsonCsrf, async (c) => {
		const blocked = await limited(c);
		if (blocked) return blocked;
		return c.json(await signInOptions(c.env.ports, relyingPartyFor(c.req.url)));
	});

	app.post("/login/verify", securityHeaders, checkJsonCsrf, async (c) => {
		const blocked = await limited(c);
		if (blocked) return blocked;
		const input = await body(c);
		const result = await finishSignIn(c.env.ports, relyingPartyFor(c.req.url), input.response);
		if (!result.ok) return c.json({ error: result.error }, 401);
		return signedIn(c, result.value.token, "/issues");
	});

	app.get("/setup", securityHeaders, async (c) => {
		if (!(await isSetupOpen(c.env.ports.db))) {
			return c.html(page({ title: "Setup is closed", body: setupClosedView() }), 404);
		}
		const devRequest = isDevRequest(c);
		const mode = devRequest ? "dev" : c.env.ports.config.setupCode ? "code" : "missing";
		return c.html(page({ title: "Set up", body: setupView(mode) }));
	});

	const setupStatus = {
		setup_closed: 403,
		invalid_code: 403,
		invalid_name: 400,
		invalid_credential: 401,
	} as const;

	app.post("/setup/options", securityHeaders, checkJsonCsrf, async (c) => {
		const blocked = await limited(c);
		if (blocked) return blocked;
		const input = await body(c);
		const result = await setupOptions(c.env.ports, relyingPartyFor(c.req.url), {
			code: input.code,
			devRequest: isDevRequest(c),
			name: input.name,
		});
		if (!result.ok) return c.json({ error: result.error }, setupStatus[result.error]);
		return c.json(result.value);
	});

	app.post("/setup/verify", securityHeaders, checkJsonCsrf, async (c) => {
		const blocked = await limited(c);
		if (blocked) return blocked;
		const input = await body(c);
		const result = await finishSetup(c.env.ports, relyingPartyFor(c.req.url), {
			code: input.code,
			devRequest: isDevRequest(c),
			response: input.response,
		});
		if (!result.ok) return c.json({ error: result.error }, setupStatus[result.error]);
		return signedIn(c, result.value.token, "/");
	});

	app.post("/logout", ...member, checkFormCsrf, async (c) => {
		const token = sessionToken(c);
		if (token) await deleteSession(c.env.ports, token);
		c.header("Set-Cookie", clearedSessionCookie());
		return c.redirect("/login", 303);
	});

	// Development only: the flag (CHECKEND_DEV, set by `npm run dev`) AND a localhost request.
	app.get("/dev/login", securityHeaders, async (c) => {
		if (!isDevRequest(c)) return notFound(c);
		const session = await createDevSession(c.env.ports);
		c.header("Set-Cookie", sessionCookie(session.token, SESSION_MAX_AGE));
		return c.redirect("/issues", 303);
	});

	// --- inbox, issue, event -------------------------------------------------------------

	const InboxParams = v.object({
		project: v.optional(v.union([v.literal(""), ProjectRef])),
		status: v.optional(v.union([v.literal(""), v.picklist(ISSUE_STATUSES)])),
		environment: v.optional(v.pipe(v.string(), v.maxLength(200))),
		release: v.optional(v.pipe(v.string(), v.maxLength(200))),
		since: v.optional(v.picklist(["", ...SINCE_CHOICES.map(([value]) => value)])),
		q: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(200))),
		cursor: v.optional(v.pipe(v.string(), v.maxLength(200))),
	});

	app.get("/issues", ...member, async (c) => {
		const parsed = v.safeParse(InboxParams, c.req.query());
		const cursor = parsed.success ? parsed.output.cursor : undefined;
		if (!parsed.success || (cursor && !decodeCursor(cursor))) {
			return render(c, "Issues", "issues", notFoundView(), 400);
		}
		const { project, status, environment, release, since, q } = parsed.output;
		const query = {
			project: project || undefined,
			status: status || undefined,
			environment: environment || undefined,
			release: release || undefined,
			since: since || undefined,
			q: q || undefined,
			cursor: cursor || undefined,
			limit: 50,
		};
		const [facets, inbox] = await Promise.all([
			inboxFacets(c.env.ports.db),
			listInbox(c.env.ports.db, query, now(c)),
		]);
		return render(c, "Issues", "issues", inboxView(query, facets, inbox, now(c)));
	});

	app.get("/issues/:id", ...member, async (c) => {
		const id = parseIssueId(c.req.param("id"));
		const issue = id === null ? null : await getIssue(c.env.ports.db, id, now(c));
		if (!issue || id === null) return notFound(c);
		const [latest, events, tags, project] = await Promise.all([
			issue.latest_event_id ? getEvent(c.env.ports.db, Number(issue.latest_event_id)) : null,
			listIssueEvents(c.env.ports.db, id, 20),
			issueTags(c.env.ports.db, id),
			c.env.ports.db.first<{ id: number; name: string }>(
				sql`SELECT public_id AS id, name FROM projects WHERE public_id = ${Number(issue.project_id)}`,
			),
		]);
		return render(
			c,
			displayText(issue.title, 80),
			"issues",
			issueView(
				{ issue, project, event: latest as Parameters<typeof issueView>[0]["event"], events, tags },
				now(c),
			),
		);
	});

	app.get("/events/:id", ...member, async (c) => {
		const id = parseEventId(c.req.param("id"));
		const event = id === null ? null : await getEvent(c.env.ports.db, id);
		if (!event) return notFound(c);
		const issue = await c.env.ports.db.first<IssueRow>(
			sql`SELECT title FROM issues WHERE id = ${Number(event.issue_id)}`,
		);
		const detail = {
			id: Number(event.id),
			issue_id: Number(event.issue_id),
			issue_title: String(issue?.title ?? ""),
			event: event.event,
		} as EventDetail;
		return render(c, "Event", "issues", eventView(detail, now(c)));
	});

	// --- home, apps ----------------------------------------------------------------------

	const origin = (c: Context) => new URL(c.req.url).origin;
	const loadProgress = async (c: Context<AppEnv>) =>
		progressJson(await onboarding.progress(c.env.ports, now(c)), now(c));
	const csrf = (c: Context<AppEnv>) => c.get("session").csrfToken;

	// Home: the prompt box and the live checklist until every app is set up; then the errors.
	app.get("/", ...member, async (c) => {
		const progress = await loadProgress(c);
		if (progress.all_complete) return c.redirect("/issues", 303);
		return render(
			c,
			"Connect your app",
			undefined,
			homeView(origin(c), csrf(c), progress, null, false),
		);
	});

	// "Copy prompt": a new setup key each time. JSON for the script; a page without JavaScript.
	app.post("/apps/setup-key", ...member, checkFormCsrf, async (c) => {
		const key = await onboarding.createSetupKey(c.env.ports, c.get("actor"));
		const prompt = key ? setupPrompt(origin(c), key.key) : null;
		if ((c.req.header("accept") ?? "").includes("application/json")) {
			c.header("Cache-Control", "no-store");
			if (!key || !prompt) return c.json({ error: "unavailable" }, 503);
			return c.json({ prompt, expires_at: key.expires_at });
		}
		const view = newAppView(origin(c), csrf(c), await loadProgress(c), prompt, key === null);
		c.header("Cache-Control", "no-store");
		return render(c, "Add an app", "apps", view);
	});

	app.get("/apps/progress", ...member, async (c) => {
		c.header("Cache-Control", "no-store");
		return c.json(await loadProgress(c));
	});

	const appRows = async (c: Context<AppEnv>): Promise<AppRow[]> => {
		const [projects, progress] = await Promise.all([
			listProjects(c.env.ports.db, now(c)),
			onboarding.progress(c.env.ports, now(c)),
		]);
		return projects.map((project) => {
			const found = progress.apps.find((a) => a.project.id === project.id) ?? null;
			const demo = (project as { demo?: boolean }).demo === true || found?.project.demo === true;
			return { project, progress: found, demo };
		});
	};

	app.get("/apps", ...member, async (c) => {
		const notice = c.req.query("deleted") === "1" ? "The app was deleted." : null;
		return render(c, "Apps", "apps", appsView(await appRows(c), origin(c), now(c), notice));
	});

	app.get("/apps/new", ...member, async (c) =>
		render(
			c,
			"Add an app",
			"apps",
			newAppView(origin(c), csrf(c), await loadProgress(c), null, false),
		),
	);

	// An app by hand, for people without a coding agent: then its manual setup tab.
	app.post("/apps", ...member, checkFormCsrf, async (c) => {
		const form = c.get("form");
		const name = typeof form.name === "string" ? form.name.trim() : "";
		const platform =
			typeof form.platform === "string" && (PLATFORMS as readonly string[]).includes(form.platform)
				? form.platform
				: null;
		if (name.length === 0 || name.length > 100) {
			const view = newAppView(origin(c), csrf(c), await loadProgress(c), null, false, {
				name: name.slice(0, 100),
				...(platform ? { platform } : {}),
				error: "An app needs a name (1 to 100 characters).",
			});
			return render(c, "Add an app", "apps", view, 400);
		}
		const project = await createProject(c.env.ports, { name, platform }, c.get("actor"));
		return c.redirect(`${appPath(project.id)}?tab=manual`, 303);
	});

	const findApp = async (c: Context<AppEnv>) => {
		const publicId = parseProjectId(c.req.param("id"));
		return (await appRows(c)).find((row) => row.project.id === publicId) ?? null;
	};

	const appPage = async (
		c: Context<AppEnv>,
		row: AppRow,
		extra: { tab?: AppTab; deleteError?: string } = {},
		status: ContentfulStatusCode = 200,
	) => {
		const sdk = c.req.query("sdk");
		const data: AppPageData = {
			project: row.project,
			progress: await loadProgress(c),
			demo: row.demo,
			tab: extra.tab ?? (c.req.query("tab") === "manual" ? "manual" : "agent"),
			sdk: SDKS.some((s) => s.id === sdk) ? sdk : undefined,
			csrf: csrf(c),
			...(extra.deleteError ? { deleteError: extra.deleteError } : {}),
		};
		return render(c, row.project.name, "apps", appView(data, origin(c), now(c)), status);
	};

	app.get("/apps/:id", ...member, async (c) => {
		const row = await findApp(c);
		return row ? appPage(c, row) : notFound(c);
	});

	// Delete: the name typed to confirm (not for the demo app), then the core delete.
	app.post("/apps/:id/delete", ...member, checkFormCsrf, async (c) => {
		const row = await findApp(c);
		if (!row) return notFound(c);
		const typed = c.get("form").confirm;
		if (!row.demo && (typeof typed !== "string" || typed.trim() !== row.project.name)) {
			return appPage(
				c,
				row,
				{ deleteError: "Type the name of the app exactly as it is shown, to confirm." },
				400,
			);
		}
		const result = await onboarding.deleteProject(c.env.ports, c.get("actor"), row.project.id);
		if (result === "deleted") return c.redirect("/apps?deleted=1", 303);
		if (result === "not_found") return notFound(c);
		const message =
			result === "approval_required"
				? "The delete waits for an approval, because this install needs approvals for deletes (REQUIRE_APPROVAL)."
				: "This install cannot delete apps yet. Update Checkend.";
		return render(
			c,
			row.project.name,
			"apps",
			h`<p class="notice" role="status">${message}</p><p><a href="${appPath(row.project.id)}">Back to the app</a></p>`,
			result === "approval_required" ? 202 : 503,
		);
	});

	// The old addresses (before "apps").
	app.get("/projects", securityHeaders, (c) => c.redirect("/apps", 301));
	app.get("/projects/:id", securityHeaders, (c) => {
		const publicId = parseProjectId(c.req.param("id"));
		return publicId === null ? notFound(c) : c.redirect(appPath(publicId), 301);
	});

	// --- settings ------------------------------------------------------------------------

	app.get("/settings", ...member, async (c) => {
		const ports = c.env.ports;
		const [health, ingest, members] = await Promise.all([
			checkHealth(ports, state),
			ingestStatus(ports, state).catch(() => null),
			ports.db.all<MemberRow & Record<string, string | number | null>>(
				sql`SELECT m.name, m.created_at, COUNT(p.id) AS passkeys, MAX(p.last_used_at) AS last_used_at
					FROM members m LEFT JOIN passkeys p ON p.member_id = m.id
					GROUP BY m.id ORDER BY m.id`,
			),
		]);
		const session = c.get("session");
		return render(
			c,
			"Settings",
			"settings",
			settingsView({ health, ingest, members, session, devMode: ports.config.devMode }, now(c)),
		);
	});

	// Unknown paths: an HTML 404 for a browser (it asks for text/html); others get the JSON 404.
	app.get("*", async (c, next) => {
		if (!(c.req.header("accept") ?? "").includes("text/html")) return next();
		return securityHeaders(c, async () => {
			c.res = await notFound(c);
		});
	});
}
