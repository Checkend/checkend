import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { makeDsn } from "@sentry/core";
import { describe, expect, it } from "vitest";
import type { FrontIdentity } from "../../../src/core/auth/front-identity.ts";
import { parseBasePath } from "../../../src/http/base-path.ts";
import { sql } from "../../../src/ports/db.ts";
import { errorEvent } from "../../support/seed.ts";
import { UI_ADMIN_TOKEN, uiApp } from "../../support/ui.ts";

/**
 * A hosted install lives under a base path: https://hosted.test/<id>/. All installs share
 * one origin, so every URL that the install makes must stay under its own base path. The crawler
 * below renders every page and every JSON and text endpoint and fails on any URL outside it.
 */
const ORIGIN = "https://hosted.test";
const BASE = "/k7q2x9";
/** The page of the front Worker that lists the spaces of the account ("Switch space"). */
const SPACES = `${ORIGIN}/spaces`;
/** The front Worker's members page of this space (owners only). */
const MEMBERS = `${SPACES}${BASE}/members`;
/**
 * Other hosts in responses: the docs on GitHub, the install script of ce (/agent/install), the JSON
 * Schema dialect of MCP tools.
 */
const EXTERNAL_HOSTS = new Set(["github.com", "raw.githubusercontent.com", "json-schema.org"]);
/** The member identity that the front Worker passes with each request of a signed-in person. */
const ALICE: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };

/** A hosted install: a base path, and members only through the trusted front identity. */
async function tenant() {
	const ui = await uiApp(
		{ publicUrl: ORIGIN, basePath: BASE, trustedFront: true, spacesUrl: SPACES },
		ORIGIN,
	);
	const admin = { authorization: `Bearer ${UI_ADMIN_TOKEN}` };
	const call = (path: string, init: RequestInit & { as?: FrontIdentity } = {}) => {
		const { as, ...rest } = init;
		return ui.request(`${BASE}${path}`, { ...rest, ...(as ? { identity: as } : {}) });
	};
	const api = async (method: string, path: string, body?: unknown, token = UI_ADMIN_TOKEN) =>
		call(path, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	/** The CSRF token of the member's forms, from a page. */
	const csrfOf = async (as: FrontIdentity = ALICE) =>
		/name="_csrf" value="([^"]+)"/.exec(await (await call("/apps/new", { as })).text())?.[1] ?? "";
	/** A form post from a page of this install, like a browser sends it. */
	const post = (
		path: string,
		fields: Record<string, string>,
		headers: Record<string, string> = {},
		as: FrontIdentity = ALICE,
	) =>
		call(path, {
			as,
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: ORIGIN,
				referer: `${ORIGIN}${BASE}/apps`,
				...headers,
			},
			body: new URLSearchParams(fields).toString(),
		});
	return { ...ui, admin, call, api, csrfOf, post };
}

type Tenant = Awaited<ReturnType<typeof tenant>>;

/** Every URL or path in a response: attributes, Location, JSON strings, absolute URLs in text. */
/** Strings of the test events (file names): event data that the API returns, not URLs it makes. */
const EVENT_DATA = new Set<string>();
JSON.stringify(errorEvent(), (_key, value) => {
	if (typeof value === "string") EVENT_DATA.add(value);
	return value;
});

function urlsOf(body: string, type: string, location: string | null): string[] {
	const found: string[] = [];
	if (location) found.push(location);
	for (const match of body.matchAll(/https?:\/\/[^\s"'<>)`\]\\]+/g)) found.push(match[0]);
	if (type.includes("html")) {
		for (const match of body.matchAll(/\s[a-z-]+="([^"]*)"/g)) {
			const value = (match[1] ?? "").replaceAll("&amp;", "&");
			if (value.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(value)) found.push(value);
		}
	}
	if (type.includes("json")) {
		const walk = (value: unknown): void => {
			if (typeof value === "string" && value.startsWith("/") && !EVENT_DATA.has(value)) {
				found.push(value);
			} else if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === "object") Object.values(value).forEach(walk);
		};
		walk(JSON.parse(body));
	}
	return found;
}

/** The URLs of a response that leave the base path of this install. */
async function outside(response: Response): Promise<string[]> {
	const body = await response.clone().text();
	const type = response.headers.get("content-type") ?? "";
	const bad: string[] = [];
	for (const raw of urlsOf(body, type, response.headers.get("location"))) {
		const value = raw.replace(/[.,;:]+$/, "");
		if (value.startsWith("#") || value === "data:" || value.startsWith("data:")) continue;
		if (value.startsWith("//")) {
			bad.push(value);
			continue;
		}
		if (value.startsWith("/")) {
			if (!value.startsWith(`${BASE}/`)) bad.push(value);
			continue;
		}
		let url: URL;
		try {
			url = new URL(value);
		} catch {
			bad.push(value);
			continue;
		}
		if (url.protocol === "mailto:") continue;
		if (url.host === new URL(ORIGIN).host) {
			// The links out of the install: the spaces page of the front Worker and its members
			// page of this space. The install itself (for example `ce setup --url <it>`) or a path
			// under it.
			const inside = url.pathname === BASE || url.pathname.startsWith(`${BASE}/`);
			if (!inside && value !== SPACES && value !== MEMBERS) bad.push(value);
		} else if (!EXTERNAL_HOSTS.has(url.hostname)) {
			// A URL on another host. A DSN carries a key as user name: the host must still be ours.
			bad.push(value);
		}
	}
	return bad;
}

/** Data on every page: two apps, issues and events, a setup key, an API token. */
async function seeded(t: Tenant) {
	const created = (await (await t.api("POST", "/v1/projects", { name: "Shop" })).json()) as {
		data: { id: number; dsn: string };
	};
	const dsn = new URL(created.data.dsn);
	for (const value of ["cart is undefined", "page out of range"]) {
		const sent = await t.call(`/api/${created.data.id}/envelope/?sentry_key=${dsn.username}`, {
			method: "POST",
			body: `{}\n{"type":"event"}\n${JSON.stringify(errorEvent({ value, fn: value.slice(0, 4) }))}\n`,
		});
		expect(sent.status).toBe(200);
		await t.settle();
	}
	const issues = await t.ports.db.all<{ id: number }>(sql`SELECT id FROM issues ORDER BY id`);
	const events = await t.ports.db.all<{ id: number }>(sql`SELECT id FROM events ORDER BY id`);
	const csrf = await t.csrfOf();
	return { csrf, project: created.data, dsn, issues, events };
}

describe("a base path: every URL stays under /<id>/", () => {
	it("parses only a lower-case path of safe segments", () => {
		expect(parseBasePath("")).toBe("");
		expect(parseBasePath("/k7q2x9")).toBe("/k7q2x9");
		expect(parseBasePath("/k7q2x9/")).toBe("/k7q2x9");
		expect(parseBasePath("/tools/errors")).toBe("/tools/errors");
		for (const bad of [
			"k7q2x9",
			"/",
			"//k7q2x9",
			"/K7Q2X9",
			"/k7q2x9//a",
			"/../k7q2x9",
			"/k7q2x9/..",
			"/k7%2Fq",
			"/k7_q",
			"/k7 q",
			"/k7q2x9?x=1",
			"/k7q2x9#x",
			`/${"a".repeat(64)}`,
		]) {
			expect(() => parseBasePath(bad), bad).toThrow();
		}
	});

	it("answers only under its base path: anything else is a 404", async () => {
		const t = await tenant();
		for (const path of ["/health", "/llms.txt", "/issues", "/k7q2x9x/health", "/k7q2x/health"]) {
			const response = await t.request(path, { headers: { accept: "text/html" } });
			expect(response.status, path).toBe(404);
		}
		expect((await t.call("/health")).status).toBe(200);
		expect((await t.request(BASE, { identity: ALICE })).status).toBe(200);
	});

	it("renders every UI page with links, forms, assets and redirects under the base path", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const pages = [
			"/",
			"/?range=live&issues=regressed",
			"/dashboard/series?range=live",
			"/issues",
			`/issues?project=${d.project.id}&status=unresolved`,
			`/issues/${d.issues[0]?.id}`,
			`/events/${d.events[0]?.id}`,
			"/apps",
			"/apps/new",
			`/apps/${d.project.id}`,
			`/apps/${d.project.id}?tab=manual`,
			`/apps/${d.project.id}?tab=setup`,
			"/apps/progress",
			"/settings",
			"/settings/tokens",
			"/projects",
			`/projects/${d.project.id}`,
			"/no-such-page",
		];
		for (const path of pages) {
			const response = await t.call(path, { as: ALICE, headers: { accept: "text/html" } });
			expect(response.status, path).toBeLessThan(500);
			expect(await outside(response), path).toEqual([]);
		}
		const home = await (await t.call("/apps/new", { as: ALICE })).text();
		expect(home).toContain(`href="${BASE}/"`);
		expect(home).toContain(`href="${BASE}/apps"`);
		expect(home).toContain(`href="${SPACES}"`);
		expect(home).not.toContain("/logout");
		expect(home).toMatch(new RegExp(`src="${BASE}/assets/app\\.[0-9a-f]+\\.js"`));
		// The assets answer under the base path.
		const script = /src="([^"]+\.js)"/.exec(home)?.[1] ?? "";
		expect((await t.request(script)).status).toBe(200);
		// Without an identity from the front Worker: a 404, with no URL outside the base path.
		for (const path of ["/issues", "/login", "/setup"]) {
			const response = await t.call(path, { headers: { accept: "text/html" } });
			expect(response.status, path).toBe(404);
			expect(await outside(response), path).toEqual([]);
		}
	});

	it("links an owner, and only an owner, to the members page of the space at the front", async () => {
		const t = await tenant();
		const owner = await (await t.call("/settings", { as: ALICE })).text();
		expect(owner).toContain(`href="${MEMBERS}"`);
		expect(owner).toContain("Members of this space");
		const member = await (
			await t.call("/settings", { as: { accountId: "acc2bob", name: "Bob", role: "member" } })
		).text();
		expect(member).not.toContain(MEMBERS);
	});

	it("keeps form posts, their redirects and the JSON of the UI under the base path", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const form = (path: string, fields: Record<string, string>, headers = {}) =>
			t.post(path, { _csrf: d.csrf, ...fields }, headers);
		const created = await form("/apps", { name: "Web" });
		expect(created.status).toBe(303);
		expect(created.headers.get("location")).toMatch(new RegExp(`^${BASE}/apps/\\d+\\?tab=manual$`));
		const prompt = await form("/apps/setup-key", {}, { accept: "application/json" });
		expect(prompt.status).toBe(200);
		expect(await outside(prompt)).toEqual([]);
		expect(((await prompt.json()) as { prompt: string }).prompt).toContain(
			`ce setup --url ${ORIGIN}${BASE}`,
		);
		const page = await form("/apps/setup-key", {});
		expect(await outside(page)).toEqual([]);
		const deleted = await form(`/apps/${d.project.id}/delete`, { confirm: "Shop" });
		expect(deleted.headers.get("location")).toBe(`${BASE}/apps?deleted=1`);
	});

	it("puts the base path in the DSN, so that a Sentry SDK sends to /<id>/api/<project>/envelope/", async () => {
		const t = await tenant();
		const d = await seeded(t);
		expect(d.project.dsn).toMatch(new RegExp(`^https://[0-9a-f]+@hosted\\.test${BASE}/\\d+$`));
		const parsed = makeDsn(d.project.dsn);
		expect(parsed?.path).toBe(BASE.slice(1));
		expect(parsed?.projectId).toBe(String(d.project.id));
		// The envelope URL of the SDK (@sentry/core getEnvelopeEndpointWithUrlEncodedAuth).
		const { getEnvelopeEndpointWithUrlEncodedAuth } = await import("@sentry/core");
		const endpoint = new URL(getEnvelopeEndpointWithUrlEncodedAuth(parsed as never));
		expect(endpoint.pathname).toBe(`${BASE}/api/${d.project.id}/envelope/`);
		const sent = await t.request(`${endpoint.pathname}${endpoint.search}`, {
			method: "POST",
			body: `{}\n{"type":"event"}\n${JSON.stringify(errorEvent({ value: "from the sdk url" }))}\n`,
		});
		expect(sent.status).toBe(200);
	});

	it("keeps every URL of the JSON API, /v1/setup and the public docs under the base path", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const key = (
			(await (await t.api("POST", "/v1/setup/keys", {})).json()) as {
				data: { key: string };
			}
		).data.key;
		const responses: [string, Response][] = [];
		const get = async (path: string, token: string | null = UI_ADMIN_TOKEN) =>
			responses.push([
				path,
				await t.call(path, token ? { headers: { authorization: `Bearer ${token}` } } : {}),
			]);
		for (const path of [
			"/v1/projects",
			`/v1/projects/${d.project.id}`,
			`/v1/projects/${d.project.id}/keys`,
			"/v1/issues",
			`/v1/issues/${d.issues[0]?.id}`,
			`/v1/issues/${d.issues[0]?.id}/events`,
			`/v1/issues/${d.issues[0]?.id}/activity`,
			`/v1/events/${d.events[0]?.id}`,
			"/v1/activity",
			"/v1/alerts",
			"/v1/approvals",
			"/v1/labels",
			"/v1/releases",
			"/v1/tokens",
			"/v1/webhooks",
			"/v1/setup/keys",
			"/v1/fix-outcomes",
			"/v1/sourcemaps",
			"/v1/deploys",
			"/v1/similar?issue=1",
		]) {
			await get(path);
		}
		await get("/v1/setup/progress", key);
		for (const path of [
			"/llms.txt",
			"/skill.md",
			"/v1/openapi.json",
			"/agent/install",
			"/agent/setup.md",
			"/agent/tasks/sourcemaps.md",
			"/agent/tasks/deploys.md",
			"/agent/tasks/migrate-from-sentry.md",
			"/agent/tasks/rotate-dsn.md",
			"/agent/tasks/delete-project.md",
			"/agent/tasks/environments.md",
			"/health",
		]) {
			await get(path, null);
		}
		const registered = await t.api(
			"POST",
			"/v1/setup/apps",
			{ name: "Api", platform: "node" },
			key,
		);
		responses.push(["/v1/setup/apps", registered]);
		responses.push([
			"/v1/projects/:id/keys",
			await t.api("POST", `/v1/projects/${d.project.id}/keys`, {}),
		]);
		for (const [path, response] of responses) {
			expect(response.status, path).toBeLessThan(500);
			expect(await outside(response), path).toEqual([]);
		}
		const llms = await (await t.call("/llms.txt")).text();
		expect(llms).toContain(`${ORIGIN}${BASE}/mcp`);
		const spec = (await (await t.call("/v1/openapi.json")).json()) as {
			servers: { url: string }[];
		};
		expect(spec.servers).toEqual([{ url: `${ORIGIN}${BASE}` }]);
	});

	it("serves MCP under the base path, with no URL outside it", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const client = new Client({ name: "base-path-test", version: "1.0.0" });
		const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}${BASE}/mcp`), {
			fetch: async (input, init) => {
				const request = new Request(input, init);
				request.headers.set("authorization", `Bearer ${UI_ADMIN_TOKEN}`);
				const url = new URL(request.url);
				expect(url.pathname).toBe(`${BASE}/mcp`);
				const response = await t.request(`${url.pathname}${url.search}`, {
					method: request.method,
					headers: request.headers,
					...(request.method === "POST" ? { body: await request.text() } : {}),
				});
				return response;
			},
		});
		await client.connect(transport);
		const texts: string[] = [];
		const tools = await client.listTools();
		texts.push(JSON.stringify(tools));
		for (const [name, args] of [
			["list_issues", {}],
			["get_issue_brief", { issue_id: d.issues[0]?.id }],
			["get_event", { event_id: d.events[0]?.id }],
			["list_releases", {}],
			["list_alerts", {}],
		] as const) {
			texts.push(JSON.stringify(await client.callTool({ name, arguments: args })));
		}
		await client.close();
		for (const text of texts) {
			const bad = await outside(
				new Response(text, { headers: { "content-type": "application/json" } }),
			);
			expect(bad).toEqual([]);
		}
	});

	it("covers every GET route of the app in the crawl above", async () => {
		const t = await tenant();
		const crawled = [
			"/",
			"/health",
			"/llms.txt",
			"/skill.md",
			"/v1/openapi.json",
			"/agent/install",
			"/agent/setup.md",
			"/agent/tasks/:file",
			"/issues",
			"/issues/:id",
			"/events/:id",
			"/apps",
			"/apps/new",
			"/apps/:id",
			"/apps/progress",
			"/dashboard/series",
			"/settings",
			"/settings/tokens",
			"/projects",
			"/projects/:id",
			"/login",
			"/setup",
			"/dev/login",
			"/mcp",
			"/*",
		];
		const routes = new Set(
			t.app.routes
				.filter(
					(r) => r.method === "GET" && !r.path.startsWith("/v1/") && !r.path.startsWith("/assets/"),
				)
				.map((r) => r.path),
		);
		for (const path of routes) expect(crawled, path).toContain(path);
	});
});

describe("a base path: the cross-tenant request guard", () => {
	const OTHER = `${ORIGIN}/b3m8wz/issues`;

	it("refuses a script request whose Referer is not under this install", async () => {
		const t = await tenant();
		await seeded(t);
		const script = (referer: string | null, extra: Record<string, string> = {}) =>
			t.call("/apps/progress", {
				as: ALICE,
				headers: {
					"sec-fetch-site": "same-origin",
					"sec-fetch-mode": "cors",
					"sec-fetch-dest": "empty",
					...(referer === null ? {} : { referer }),
					...extra,
				},
			});
		expect((await script(`${ORIGIN}${BASE}/apps`)).status).toBe(200);
		expect((await script(`${ORIGIN}${BASE}/`)).status).toBe(200);
		for (const referer of [
			OTHER,
			`${ORIGIN}/`,
			`${ORIGIN}${BASE}x/apps`,
			`${ORIGIN}/b3m8wz${BASE}/`,
			"https://evil.example/k7q2x9/",
		]) {
			const response = await script(referer);
			expect(response.status, referer).toBe(403);
		}
		expect((await script(null)).status).toBe(403);
		// The other fetch modes of a script: same-origin, no-cors (also sendBeacon).
		for (const mode of ["same-origin", "no-cors"]) {
			expect((await script(OTHER, { "sec-fetch-mode": mode })).status, mode).toBe(403);
		}
		// A subresource (an image) from another install's page.
		expect(
			(await script(OTHER, { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image" })).status,
		).toBe(403);
		// A browser without Sec-Fetch headers: the Referer decides.
		const old = (referer: string) => t.call("/apps/progress", { as: ALICE, headers: { referer } });
		expect((await old(OTHER)).status).toBe(403);
		expect((await old(`${ORIGIN}${BASE}/apps`)).status).toBe(200);
	});

	it("applies the guard to JSON routes and form posts too", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const headers = {
			"sec-fetch-site": "same-origin",
			"sec-fetch-mode": "cors",
			"sec-fetch-dest": "empty",
			referer: OTHER,
		};
		const json = await t.call("/apps/setup-key", {
			as: ALICE,
			method: "POST",
			headers: { ...headers, origin: ORIGIN, accept: "application/json" },
			body: new URLSearchParams({ _csrf: d.csrf }),
		});
		expect(json.status).toBe(403);
		const posted = await t.post(
			"/apps",
			{ _csrf: d.csrf, name: "X" },
			{ ...headers, "sec-fetch-mode": "no-cors" },
		);
		expect(posted.status).toBe(403);
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM projects WHERE name = 'X'`)).toBeNull();
		const api = await t.call("/v1/projects", {
			as: ALICE,
			headers: { ...headers, authorization: `Bearer ${UI_ADMIN_TOKEN}` },
		});
		expect(api.status).toBe(403);
	});

	it("allows navigations, other sites (browser SDKs) and bearer calls without a member", async () => {
		const t = await tenant();
		const d = await seeded(t);
		const navigation = await t.call("/apps", {
			as: ALICE,
			headers: {
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "navigate",
				"sec-fetch-dest": "document",
				referer: OTHER,
			},
		});
		expect(navigation.status).toBe(200);
		// A browser SDK on the customer's site sends errors with fetch.
		const sdk = await t.call(`/api/${d.project.id}/envelope/?sentry_key=${d.dsn.username}`, {
			method: "POST",
			headers: {
				"sec-fetch-site": "cross-site",
				"sec-fetch-mode": "cors",
				"sec-fetch-dest": "empty",
				referer: "https://shop.example/cart",
				origin: "https://shop.example",
			},
			body: `{}\n{"type":"event"}\n${JSON.stringify(errorEvent())}\n`,
		});
		expect(sdk.status).toBe(200);
		// curl, the CLI, an agent: no Sec-Fetch headers, no Referer.
		expect((await t.api("GET", "/v1/projects")).status).toBe(200);
		// A bearer call without a member identity is not ambient authority, even from a page.
		const bearer = await t.call("/v1/projects", {
			headers: {
				authorization: `Bearer ${UI_ADMIN_TOKEN}`,
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "cors",
				"sec-fetch-dest": "empty",
				referer: OTHER,
			},
		});
		expect(bearer.status).toBe(200);
	});
});

describe("without a base path", () => {
	it("keeps the root paths and the default cookie, as before", async () => {
		const t = await uiApp();
		const { token } = await t.signIn();
		const page = await (await t.request("/apps/new", { session: token })).text();
		expect(page).toContain('href="/apps"');
		expect(page).toContain('action="/logout"');
		const other = await t.request("/apps/progress", {
			session: token,
			headers: {
				"sec-fetch-site": "same-origin",
				"sec-fetch-mode": "cors",
				"sec-fetch-dest": "empty",
				referer: "https://checkend.test/elsewhere",
			},
		});
		expect(other.status).toBe(200);
	});
});
